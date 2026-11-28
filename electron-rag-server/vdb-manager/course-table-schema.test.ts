import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "@lancedb/lancedb";
import type { Schema } from "apache-arrow";
import type { Table } from "@lancedb/lancedb";
import {
  COURSE_CHUNK_TABLE_NAME,
  COURSE_TABLE_NAME,
  createCourseChunkTableSchema,
  createCourseTableSchema,
} from "./course-table-schemas.js";
import { CourseTableManager } from "./course-table-manager.js";

async function assertTableSchema(
  tableName: string,
  table: Table,
  expected: Schema,
): Promise<void> {
  const actual = await table.schema();
  assert.equal(actual.fields.length, expected.fields.length, `${tableName}: column count`);

  for (let index = 0; index < expected.fields.length; index += 1) {
    const expectedField = expected.fields[index];
    const actualField = actual.fields[index];
    assert.ok(expectedField, `${tableName}: expected field ${index} exists`);
    assert.ok(actualField, `${tableName}: actual field ${index} exists`);
    assert.equal(actualField.name, expectedField.name, `${tableName}: field ${index} name`);
    assert.equal(
      actualField.type.toString(),
      expectedField.type.toString(),
      `${tableName}.${expectedField.name}: Arrow type`,
    );
    assert.equal(
      actualField.nullable,
      expectedField.nullable,
      `${tableName}.${expectedField.name}: nullability`,
    );
  }
}

async function runSchemaIntegrationTest(): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "rag-lancedb-schema-"));
  const databasePath = join(temporaryDirectory, "database");
  const connections: Array<Awaited<ReturnType<typeof connect>>> = [];

  try {
    const firstConnection = await connect(databasePath);
    connections.push(firstConnection);
    const firstManager = new CourseTableManager(firstConnection);
    const firstTables = await firstManager.ensureTables();
    const cachedTables = await firstManager.ensureTables();

    assert.strictEqual(cachedTables.courses, firstTables.courses);
    assert.strictEqual(cachedTables.courseChunks, firstTables.courseChunks);
    assert.deepEqual(
      (await firstConnection.tableNames()).sort(),
      [COURSE_TABLE_NAME, COURSE_CHUNK_TABLE_NAME].sort(),
    );
    await assertTableSchema(COURSE_TABLE_NAME, firstTables.courses, createCourseTableSchema());
    await assertTableSchema(
      COURSE_CHUNK_TABLE_NAME,
      firstTables.courseChunks,
      createCourseChunkTableSchema(),
    );

    firstConnection.close();
    const reopenedConnection = await connect(databasePath);
    connections.push(reopenedConnection);
    const reopenedTables = await new CourseTableManager(reopenedConnection).ensureTables();

    assert.deepEqual(
      (await reopenedConnection.tableNames()).sort(),
      [COURSE_TABLE_NAME, COURSE_CHUNK_TABLE_NAME].sort(),
    );
    await assertTableSchema(COURSE_TABLE_NAME, reopenedTables.courses, createCourseTableSchema());
    await assertTableSchema(
      COURSE_CHUNK_TABLE_NAME,
      reopenedTables.courseChunks,
      createCourseChunkTableSchema(),
    );

    console.log(
      "LanceDB schema integration test passed: both tables created, validated, and reopened with identical Arrow schemas.",
    );
  } finally {
    for (const connection of connections) connection.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

await runSchemaIntegrationTest();
