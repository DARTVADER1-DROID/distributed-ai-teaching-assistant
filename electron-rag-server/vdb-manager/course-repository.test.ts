import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "@lancedb/lancedb";
import { RagConfig } from "../config/config.js";
import { DocumentNodeType } from "../extractor/extractor-service.js";
import { ValidationReport } from "../validator/font-size-validator.js";
import type { CoursePipelineResult } from "./create-course.js";
import { CourseRepository, CourseNotFoundError } from "./course-repository.js";
import { CourseTableManager } from "./course-table-manager.js";

function pipelineResult(courseId: string, suffix: string): CoursePipelineResult {
  return {
    identity: {
      course_id: courseId,
      document_name: `${suffix}.pdf`,
      document_name_key: `${suffix}.pdf`,
      document_hash: suffix.padEnd(64, "a").slice(0, 64),
    },
    validation: new ValidationReport(),
    material: {
      is_successful: true,
      error: "",
      document: {
        type: DocumentNodeType.Document,
        heading_level: 0,
        text: "",
        page_number: 0,
        line_number: 0,
        end_page_number: 0,
        page_count: 1,
        end_line_number: 0,
        children: [],
      },
    },
    chunks: [{
      index: 0,
      text: `body ${suffix}`,
      embedding_text: `heading\nbody ${suffix}`,
      heading_path: ["heading"],
      token_count: 4,
      start_page_number: 1,
      start_line_number: 1,
      end_page_number: 1,
      end_line_number: 1,
    }],
    embeddings: {
      model_id: "test-model",
      dimensions: 1024,
      embeddings: [Array.from({ length: 1024 }, () => 0.125)],
    },
    page_count: 1,
  };
}

async function runCourseRepositoryTest(): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "rag-course-repository-"));
  const connection = await connect(join(temporaryDirectory, "database"));
  try {
    const tables = await new CourseTableManager(connection).ensureTables();
    const repository = new CourseRepository(tables.courses, tables.courseChunks);
    const id = "7a1a3a84-3fd7-4d75-a75d-6adca39b7f8d";

    await repository.create(pipelineResult(id, "first"));
    const created = await repository.get(id);
    assert.ok(created);
    assert.equal(created.document_name, "first.pdf");
    assert.equal((await repository.getAll()).length, 1);
    assert.equal((await tables.courseChunks.query().where(`course_id = '${id}'`).toArray()).length, 1);

    await repository.replace(id, pipelineResult(id, "second"));
    const replaced = await repository.get(id);
    assert.ok(replaced);
    assert.equal(replaced.document_name, "second.pdf");
    const activeRows = await tables.courseChunks
      .query()
      .where(`course_id = '${id}'`)
      .toArray();
    assert.equal(activeRows.length, 1);
    assert.equal(activeRows[0]?.content, "body second");

    assert.equal(await repository.delete(id), true);
    assert.equal(await repository.get(id), null);
    assert.equal(await repository.delete(id), false);
    await assert.rejects(repository.replace(id, pipelineResult(id, "third")), CourseNotFoundError);

    await repository.create(pipelineResult(id, "fourth"));
    assert.equal(await repository.deleteAll(), 1);
    assert.equal(await repository.deleteAll(), 0);
    assert.equal((await repository.getAll()).length, 0);
    assert.equal((await tables.courseChunks.query().toArray()).length, 0);

    console.log("Course repository integration test passed: create, read, list, generation replacement, delete and delete-all.");
  } finally {
    connection.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

await runCourseRepositoryTest();
