import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "@lancedb/lancedb";
import { RagConfig } from "../config/config.js";
import { DocumentNodeType } from "../extractor/extractor-service.js";
import { ValidationReport } from "../validator/font-size-validator.js";
import type { CoursePipelineResult } from "./create-course.js";
import { CreateCourse } from "./create-course.js";
import { VdbManagerService } from "./vdb-manager-service.js";
import { CourseRepository, CourseNotFoundError } from "./course-repository.js";
import { CourseTableManager } from "./course-table-manager.js";
import { calculateDocumentHash } from "./document-fingerprint.js";
import { CourseUnchangedError } from "./update-course.js";

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
      embedding_text: `heading
body ${suffix}`,
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
    const originalBytes = new TextEncoder().encode("first pdf bytes");
    const initial = pipelineResult(id, "first");
    initial.identity.document_hash = calculateDocumentHash(originalBytes);
    let pipelineCalls = 0;
    const replacementPipeline = {
      async execute(request: { document_name: string; document_bytes: Uint8Array }, courseId: string) {
        pipelineCalls += 1;
        if (request.document_name === "broken.pdf") throw new Error("Replacement processing failed.");
        const result = pipelineResult(courseId, "second");
        result.identity.document_name = request.document_name;
        result.identity.document_name_key = request.document_name.toLowerCase();
        result.identity.document_hash = calculateDocumentHash(request.document_bytes);
        return result;
      },
    } as unknown as CreateCourse;
    const manager = new VdbManagerService(replacementPipeline, repository, {
      async embedTexts(texts: string[]) {
        return { model_id: "test-model", dimensions: 1024, embeddings: texts.map(() => Array.from({ length: 1024 }, () => 0.125)) };
      },
    });

    await repository.create(initial);
    const created = await repository.get(id);
    assert.ok(created);
    assert.equal(created.document_name, "first.pdf");
    assert.equal(created.document_hash, initial.identity.document_hash);
    assert.match(created.active_generation_id, /^[0-9a-f-]{36}$/i);
    assert.ok(Number.isFinite(Date.parse(created.created_at)));
    assert.equal(created.updated_at, created.created_at);
    assert.deepEqual(created.material, initial.material);
    assert.equal((await repository.getAll()).length, 1);
    assert.equal((await tables.courseChunks.query().where(`course_id = '${id}'`).toArray()).length, 1);

    await assert.rejects(
      manager.updateCourse(id, { document_name: "first.pdf", document_bytes: originalBytes }),
      CourseUnchangedError,
    );
    assert.equal(pipelineCalls, 0, "No-op update must be rejected before parsing or embedding.");

    await assert.rejects(
      manager.updateCourse(id, {
        document_name: "broken.pdf",
        document_bytes: new TextEncoder().encode("broken replacement"),
      }),
      /Replacement processing failed/,
    );
    const preservedAfterFailure = await repository.get(id);
    assert.equal(preservedAfterFailure?.document_name, "first.pdf");

    const replacementBytes = new TextEncoder().encode("second pdf bytes");
    const updated = await manager.updateCourse(id, {
      document_name: "second.pdf",
      document_bytes: replacementBytes,
    });
    assert.equal(updated.identity.course_id, id);
    assert.equal(pipelineCalls, 2);

    const replaced = await repository.get(id);
    assert.ok(replaced);
    assert.equal(replaced.document_name, "second.pdf");
    assert.notEqual(replaced.active_generation_id, created.active_generation_id);
    assert.equal(replaced.created_at, created.created_at);
    assert.ok(Date.parse(replaced.updated_at) >= Date.parse(created.updated_at));
    assert.deepEqual(replaced.material, initial.material);
    const activeRows = await tables.courseChunks
      .query()
      .where(`course_id = '${id}'`)
      .toArray();
    assert.equal(activeRows.length, 1);
    assert.equal(activeRows[0]?.content, "body second");

    const searchResults = await manager.searchCourses("find the second lecture", { course_id: id, top_k: 3 });
    assert.equal(searchResults.results.length, 1);
    assert.equal(searchResults.results[0]?.content, "body second");
    assert.deepEqual(searchResults.results[0]?.heading_path, ["heading"]);
    assert.equal(searchResults.results[0]?.document_name, "second.pdf");
    await assert.rejects(manager.searchCourses("   "), /non-empty string/);
    await assert.rejects(manager.searchCourses("valid", { top_k: 0 }), /between 1 and 50/);
    await assert.rejects(
      manager.searchCourses("valid", { course_id: "00000000-0000-4000-8000-000000000000" }),
      CourseNotFoundError,
    );

    assert.equal(await manager.deleteCourse(id), true);
    assert.equal(await repository.get(id), null);
    assert.equal(await manager.deleteCourse(id), false);
    await assert.rejects(repository.replace(id, pipelineResult(id, "third")), CourseNotFoundError);

    await repository.create(pipelineResult(id, "fourth"));
    assert.equal(await manager.deleteAllCourses(), 1);
    assert.equal(await manager.deleteAllCourses(), 0);
    assert.equal((await repository.getAll()).length, 0);
    assert.equal((await tables.courseChunks.query().toArray()).length, 0);

    console.log("Course repository integration test passed: create, read, list, no-op rejection, failed-update preservation, full generation replacement, delete and delete-all.");
  } finally {
    connection.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

await runCourseRepositoryTest();
