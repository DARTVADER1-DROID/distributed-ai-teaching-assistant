import type { Connection, Table } from "@lancedb/lancedb";
import type { Schema } from "apache-arrow";
import {
  COURSE_CHUNK_TABLE_NAME,
  COURSE_TABLE_NAME,
  createCourseChunkTableSchema,
  createCourseTableSchema,
} from "./course-table-schemas.js";

export interface CourseTables {
  courses: Table;
  courseChunks: Table;
}

/**
 * Creates the two empty tables on first use, or opens and validates them
 * on later starts. Existing tables are never overwritten.
 */
export class CourseTableManager {
  private initializationPromise?: Promise<CourseTables>;

  public constructor(private readonly connection: Connection) {}

  public ensureTables(): Promise<CourseTables> {
    if (!this.initializationPromise) {
      const pending = this.initializeTables();
      this.initializationPromise = pending;
      void pending.catch(() => {
        if (this.initializationPromise === pending) {
          this.initializationPromise = undefined;
        }
      });
    }
    return this.initializationPromise;
  }

  private async initializeTables(): Promise<CourseTables> {
    const existingNames = new Set(await this.connection.tableNames());
    const courses = await this.openOrCreateTable(
      COURSE_TABLE_NAME,
      createCourseTableSchema(),
      existingNames,
    );
    const courseChunks = await this.openOrCreateTable(
      COURSE_CHUNK_TABLE_NAME,
      createCourseChunkTableSchema(),
      existingNames,
    );
    return { courses, courseChunks };
  }

  private async openOrCreateTable(
    tableName: string,
    expectedSchema: Schema,
    existingNames: Set<string>,
  ): Promise<Table> {
    const table = existingNames.has(tableName)
      ? await this.connection.openTable(tableName)
      : await this.connection.createEmptyTable(tableName, expectedSchema);
    const actualSchema = await table.schema();
    this.assertCompatibleSchema(tableName, expectedSchema, actualSchema);
    return table;
  }

  private assertCompatibleSchema(
    tableName: string,
    expected: Schema,
    actual: Schema,
  ): void {
    const expectedFields = expected.fields;
    const actualFields = actual.fields;
    if (expectedFields.length !== actualFields.length) {
      throw new Error(
        `LanceDB table '${tableName}' has ${actualFields.length} columns; expected ${expectedFields.length}. No automatic schema migration was performed.`,
      );
    }

    for (let index = 0; index < expectedFields.length; index += 1) {
      const expectedField = expectedFields[index];
      const actualField = actualFields[index];
      if (
        !expectedField ||
        !actualField ||
        expectedField.name !== actualField.name ||
        expectedField.type.toString() !== actualField.type.toString()
      ) {
        throw new Error(
          `LanceDB table '${tableName}' has an incompatible column at position ${index}. Expected '${expectedField?.name ?? "unknown"}' (${expectedField?.type.toString() ?? "unknown"}); received '${actualField?.name ?? "unknown"}' (${actualField?.type.toString() ?? "unknown"}). No automatic schema migration was performed.`,
        );
      }
    }
  }
}
