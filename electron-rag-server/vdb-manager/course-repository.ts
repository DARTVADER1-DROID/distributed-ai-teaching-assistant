import { randomUUID } from "node:crypto";
import type { Table } from "@lancedb/lancedb";
import type { Course } from "./course.js";
import type { CoursePipelineResult } from "./create-course.js";
import {
  deserializeCourseMaterial,
  serializeCourseMaterial,
  type CourseChunkRecord,
  type CourseRecord,
} from "./storage-records.js";

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function coursePredicate(courseId: string): string {
  return `course_id = ${sqlString(courseId)}`;
}

/**
 * Persistence boundary for the catalogue and chunk tables.
 * New chunk generations are written before the catalogue switches to them.
 */
export class CourseRepository {
  public constructor(
    private readonly courses: Table,
    private readonly chunks: Table,
  ) {}

  public async create(result: CoursePipelineResult): Promise<void> {
    const generationId = randomUUID();
    const chunkRows = this.toChunkRecords(result, generationId);
    const now = new Date().toISOString();

    await this.chunks.add(chunkRows);
    try {
      const record: CourseRecord = {
        course_id: result.identity.course_id,
        document_name: result.identity.document_name,
        document_name_key: result.identity.document_name_key,
        document_hash: result.identity.document_hash,
        material_json: serializeCourseMaterial(result.material),
        active_generation_id: generationId,
        created_at: now,
        updated_at: now,
      };
      await this.courses.add([record]);
    } catch (error) {
      await this.chunks.delete(
        `${coursePredicate(result.identity.course_id)} AND generation_id = ${sqlString(generationId)}`,
      );
      throw error;
    }
  }

  /** Atomically switches the catalogue pointer after the replacement chunks are present. */
  public async replace(
    courseId: string,
    result: CoursePipelineResult,
  ): Promise<void> {
    const existing = await this.findRecord(courseId);
    if (!existing) {
      throw new CourseNotFoundError(courseId);
    }

    const generationId = randomUUID();
    const chunkRows = this.toChunkRecords(result, generationId);
    await this.chunks.add(chunkRows);

    const updatedRecord: CourseRecord = {
      ...existing,
      document_name: result.identity.document_name,
      document_name_key: result.identity.document_name_key,
      document_hash: result.identity.document_hash,
      material_json: serializeCourseMaterial(result.material),
      active_generation_id: generationId,
      updated_at: new Date().toISOString(),
    };

    try {
      // LanceDB's update expression API treats string values as SQL expressions.
      // Replacing the catalogue row via delete/add preserves JSON strings verbatim.
      await this.courses.delete(coursePredicate(courseId));
      await this.courses.add([updatedRecord]);
    } catch (error) {
      const remaining = await this.findRecord(courseId);
      if (!remaining) {
        await this.courses.add([existing]);
      }
      await this.chunks.delete(
        `${coursePredicate(courseId)} AND generation_id = ${sqlString(generationId)}`,
      );
      throw error;
    }

    await this.chunks.delete(
      `${coursePredicate(courseId)} AND generation_id != ${sqlString(generationId)}`,
    );
  }

  public async get(courseId: string): Promise<Course | null> {
    const record = await this.findRecord(courseId);
    if (!record) return null;

    return {
      course_id: record.course_id,
      document_name: record.document_name,
      document_hash: record.document_hash,
      material: deserializeCourseMaterial(record),
    };
  }

  public async getAll(): Promise<Course[]> {
    const records = (await this.courses.query().toArray()) as CourseRecord[];
    return records.map((record) => ({
      course_id: record.course_id,
      document_name: record.document_name,
      document_hash: record.document_hash,
      material: deserializeCourseMaterial(record),
    }));
  }

  public async delete(courseId: string): Promise<boolean> {
    const existing = await this.findRecord(courseId);
    if (!existing) return false;

    await this.chunks.delete(coursePredicate(courseId));
    await this.courses.delete(coursePredicate(courseId));
    return true;
  }

  public async deleteAll(): Promise<number> {
    const existingCourses = await this.courses.query().toArray();
    const deletedCount = existingCourses.length;

    await this.chunks.delete("course_id IS NOT NULL");
    await this.courses.delete("course_id IS NOT NULL");

    return deletedCount;
  }

  private async findRecord(courseId: string): Promise<CourseRecord | null> {
    const rows = (await this.courses
      .query()
      .where(coursePredicate(courseId))
      .limit(1)
      .toArray()) as CourseRecord[];
    return rows[0] ?? null;
  }

  private toChunkRecords(
    result: CoursePipelineResult,
    generationId: string,
  ): CourseChunkRecord[] {
    if (result.chunks.length !== result.embeddings.embeddings.length) {
      throw new Error("Cannot persist a course: chunk and embedding counts differ.");
    }

    return result.chunks.map((chunk, index) => {
      const vector = result.embeddings.embeddings[index];
      if (!vector || vector.length !== result.embeddings.dimensions) {
        throw new Error(`Cannot persist chunk ${index}: its embedding is missing or invalid.`);
      }

      return {
        chunk_id: randomUUID(),
        course_id: result.identity.course_id,
        generation_id: generationId,
        chunk_index: chunk.index,
        vector,
        embedding_model_id: result.embeddings.model_id,
        embedding_dimensions: result.embeddings.dimensions,
        content: chunk.text,
        embedding_text: chunk.embedding_text,
        heading_path_json: JSON.stringify(chunk.heading_path),
        token_count: chunk.token_count,
        start_page_number: chunk.start_page_number,
        start_line_number: chunk.start_line_number,
        end_page_number: chunk.end_page_number,
        end_line_number: chunk.end_line_number,
      };
    });
  }
}

export class CourseNotFoundError extends Error {
  public constructor(courseId: string) {
    super(`Course '${courseId}' was not found.`);
    this.name = "CourseNotFoundError";
  }
}
