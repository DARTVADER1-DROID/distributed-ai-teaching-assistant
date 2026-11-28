import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "@lancedb/lancedb";
import { CourseTableManager } from "./course-table-manager.js";
import { CourseDuplicateChecker } from "./course-duplicate-checker.js";
import { CourseDuplicateError } from "./course-duplicate-error.js";
import { CourseIdGenerator } from "./course-id-generator.js";
import { CourseIdentityFactory } from "./course-identity-factory.js";
import { calculateDocumentHash } from "./document-fingerprint.js";

async function runDuplicateCheckerIntegrationTest(): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "rag-lancedb-duplicates-"));
  const databasePath = join(temporaryDirectory, "database");
  const connection = await connect(databasePath);

  try {
    const tables = await new CourseTableManager(connection).ensureTables();
    const checker = new CourseDuplicateChecker(tables.courses);
    const idGenerator = new CourseIdGenerator();
    const identityFactory = new CourseIdentityFactory(checker, idGenerator);

    const originalBytes = new TextEncoder().encode("same exact PDF bytes");
    const firstIdentity = await identityFactory.createIdentity(
      "Engineering.pdf",
      originalBytes,
    );

    assert.match(firstIdentity.course_id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    assert.equal(firstIdentity.document_hash, calculateDocumentHash(originalBytes));
    assert.equal(firstIdentity.document_name, "Engineering.pdf");
    assert.equal(firstIdentity.document_name_key, "engineering.pdf");

    const timestamp = new Date().toISOString();
    await tables.courses.add([{
      course_id: firstIdentity.course_id,
      document_name: firstIdentity.document_name,
      document_name_key: firstIdentity.document_name_key,
      document_hash: firstIdentity.document_hash,
      material_json: "{}",
      active_generation_id: "generation-1",
      created_at: timestamp,
      updated_at: timestamp,
    }]);

    // Same filename with different bytes must be rejected.
    await assert.rejects(
      identityFactory.createIdentity(
        "engineering.PDF",
        new TextEncoder().encode("different bytes"),
      ),
      (error: unknown) =>
        error instanceof CourseDuplicateError &&
        error.reason === "DOCUMENT_NAME_ALREADY_EXISTS",
    );

    // Different filename with identical bytes must be rejected.
    await assert.rejects(
      identityFactory.createIdentity(
        "Another-name.pdf",
        originalBytes,
      ),
      (error: unknown) =>
        error instanceof CourseDuplicateError &&
        error.reason === "DOCUMENT_CONTENT_ALREADY_EXISTS",
    );

    // A different filename and different content are accepted.
    const secondIdentity = await identityFactory.createIdentity(
      "Another-name.pdf",
      new TextEncoder().encode("a genuinely different document"),
    );
    assert.notEqual(secondIdentity.course_id, firstIdentity.course_id);
    assert.notEqual(secondIdentity.document_hash, firstIdentity.document_hash);

    // Filename path components are discarded before comparison/storage.
    await assert.rejects(
      identityFactory.createIdentity(
        "C:\\uploads\\Engineering.pdf",
        new TextEncoder().encode("yet another payload"),
      ),
      (error: unknown) =>
        error instanceof CourseDuplicateError &&
        error.reason === "DOCUMENT_NAME_ALREADY_EXISTS",
    );

    console.log(
      "LanceDB duplicate-check integration test passed: filename conflicts, content conflicts, distinct uploads, and UUID generation verified.",
    );
  } finally {
    connection.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

await runDuplicateCheckerIntegrationTest();
