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
 * LanceDB does not provide a cross-table transaction, so replacement uses
 * compensating cleanup and rollback rather than claiming atomicity.
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

  /** Switches the catalogue to a prepared generation, then removes inactive chunks. */
  public async replace(
    courseId: string,
    result: CoursePipelineResult,
  ): Promise<void> {
    const existing = await this.findRecord(courseId);
    if (!existing) {
      throw new CourseNotFoundError(courseId);
    }
    if (result.identity.course_id !== courseId) {
      throw new Error("A course replacement must preserve the existing course ID.");
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
      // Replacing the catalogue row via delete/add preserves JSON strings verbatim.
      // This is a compensated two-step write, not an atomic catalogue transaction.
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
      active_generation_id: record.active_generation_id,
      created_at: record.created_at,
      updated_at: record.updated_at,
      material: deserializeCourseMaterial(record),
    };
  }

  public async getAll(): Promise<Course[]> {
    const records = (await this.courses.query().toArray()) as CourseRecord[];
    return records.map((record) => ({
      course_id: record.course_id,
      document_name: record.document_name,
      document_hash: record.document_hash,
      active_generation_id: record.active_generation_id,
      created_at: record.created_at,
      updated_at: record.updated_at,
      material: deserializeCourseMaterial(record),
    }));
  }

  /**
   * Performs cosine vector search over active generations only. The catalogue
   * is consulted first so superseded or orphaned chunk generations are never
   * exposed as current course content.
   */
  public async search(
    vector: number[],
    topK: number,
    courseId?: string,
  ): Promise<Array<{
    chunk_id: string;
    course_id: string;
    document_name: string;
    chunk_index: number;
    content: string;
    heading_path: string[];
    token_count: number;
    start_page_number: number;
    start_line_number: number;
    end_page_number: number;
    end_line_number: number;
    distance: number;
  }>> {
    if (vector.length !== 1024 || vector.some((value) => !Number.isFinite(value))) {
      throw new Error("Search vector must contain exactly 1024 finite values.");
    }
    if (!Number.isSafeInteger(topK) || topK < 1 || topK > 50) {
      throw new Error("Search topK must be an integer between 1 and 50.");
    }

    let activeCourses: CourseRecord[];
    if (courseId) {
      const record = await this.findRecord(courseId);
      if (!record) throw new CourseNotFoundError(courseId);
      activeCourses = [record];
    } else {
      activeCourses = (await this.courses.query().toArray()) as CourseRecord[];
    }
    if (activeCourses.length === 0) return [];

    if (!modelId.trim()) throw new Error("Search embedding model ID must be non-empty.");\n\n    const activePredicate = activeCourses.map((record) =>
      `(course_id = ${sqlString(record.course_id)} AND generation_id = ${sqlString(record.active_generation_id)})`,
    ).join(" OR ");

    const rows = await this.chunks
      .vectorSearch(vector)
      .distanceType("cosine")
      .where(searchPredicate)
      .select([
        "chunk_id", "course_id", "generation_id", "chunk_index", "content",
        "heading_path_json", "token_count", "start_page_number",
        "start_line_number", "end_page_number", "end_line_number", "_distance",
      ])
      .limit(topK)
      .toArray() as Array<CourseChunkRecord & { _distance: number }>;

    const names = new Map(activeCourses.map((record) => [record.course_id, record.document_name]));
    return rows.map((row) => {
      let headingPath: unknown;
      try {
        headingPath = JSON.parse(row.heading_path_json);
      } catch {
        throw new Error(`Stored heading path for chunk '${row.chunk_id}' is corrupted.`);
      }
      if (!Array.isArray(headingPath) || headingPath.some((part) => typeof part !== "string")) {
        throw new Error(`Stored heading path for chunk '${row.chunk_id}' is invalid.`);
      }
      return {
        chunk_id: row.chunk_id,
        course_id: row.course_id,
        document_name: names.get(row.course_id) ?? "",
        chunk_index: row.chunk_index,
        content: row.content,
        heading_path: headingPath as string[],
        token_count: row.token_count,
        start_page_number: row.start_page_number,
        start_line_number: row.start_line_number,
        end_page_number: row.end_page_number,
        end_line_number: row.end_line_number,
        distance: row._distance,
      };
    });
  }

  public async delete(courseId: string): Promise<boolean> {
    const existing = await this.findRecord(courseId);

    // Remove the catalogue entry first so a chunk-delete failure cannot leave
    // a visible course that no longer has searchable vectors. Retrying a
    // missing course still cleans up any orphaned chunks from a prior failure.
    if (existing) {
      await this.courses.delete(coursePredicate(courseId));
    }
    await this.chunks.delete(coursePredicate(courseId));

    return existing !== null;
  }

  public async deleteAll(): Promise<number> {
    const existingCourses = await this.courses.query().toArray();
    const deletedCount = existingCourses.length;

    // Clear the catalogue first. If chunk cleanup fails, a retry can safely
    // finish removing orphaned vectors without exposing incomplete courses.
    await this.courses.delete("course_id IS NOT NULL");
    await this.chunks.delete("course_id IS NOT NULL");

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
