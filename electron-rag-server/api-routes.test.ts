import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "./main.js";
import type { VdbManagerService } from "./vdb-manager/vdb-manager-service.js";
import { CourseNotFoundError } from "./vdb-manager/course-repository.js";
import { CourseUnchangedError } from "./vdb-manager/update-course.js";

async function runApiRouteTests(): Promise<void> {
  const courseId = "7a1a3a84-3fd7-4d75-a75d-6adca39b7f8d";
  let deleteResult = true;
  let deleteAllResult = 3;
  let updateMode: "success" | "missing" | "unchanged" = "success";
  let deleteCalls = 0;
  let deleteAllCalls = 0;
  let updateCalls = 0;

  const manager = {
    async createCourse() { throw new Error("Not used in this test."); },
    async updateCourse(id: string) {
      updateCalls += 1;
      assert.equal(id, courseId);
      if (updateMode === "missing") throw new CourseNotFoundError(id);
      if (updateMode === "unchanged") throw new CourseUnchangedError(id);
      return {
        identity: { course_id: id, document_name: "replacement.pdf" },
        page_count: 2,
        chunks: [{}],
        embeddings: {
          model_id: "test-model",
          dimensions: 1024,
          embeddings: [[0.1]],
        },
      };
    },
    async getCourse() { return null; },
    async getAllCourses() { return []; },
    async deleteCourse(id: string) {
      deleteCalls += 1;
      assert.equal(id, courseId);
      return deleteResult;
    },
    async deleteAllCourses() {
      deleteAllCalls += 1;
      return deleteAllResult;
    },
  } as unknown as VdbManagerService;

  const app = createApp(manager);
  const server = app.listen(0);
  try {
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const invalidUpdate = await fetch(`${baseUrl}/api/courses/not-a-uuid`, {
      method: "PUT",
      body: new FormData(),
    });
    assert.equal(invalidUpdate.status, 400);
    assert.equal(updateCalls, 0);

    updateMode = "missing";
    const missingUpdateBody = new FormData();
    missingUpdateBody.append("file", new Blob(["pdf"]), "new.pdf");
    const missingUpdate = await fetch(`${baseUrl}/api/courses/${courseId}`, {
      method: "PUT",
      body: missingUpdateBody,
    });
    assert.equal(missingUpdate.status, 404);

    updateMode = "unchanged";
    const unchangedBody = new FormData();
    unchangedBody.append("file", new Blob(["pdf"]), "new.pdf");
    const unchanged = await fetch(`${baseUrl}/api/courses/${courseId}`, {
      method: "PUT",
      body: unchangedBody,
    });
    assert.equal(unchanged.status, 409);
    assert.deepEqual(await unchanged.json(), {
      error: `Course '${courseId}' is already up to date; the filename and document content are unchanged.`,
      reason: "COURSE_UNCHANGED",
    });

    updateMode = "success";
    const replacementBody = new FormData();
    replacementBody.append("file", new Blob(["replacement pdf"], { type: "application/pdf" }), "replacement.pdf");
    const updated = await fetch(`${baseUrl}/api/courses/${courseId}`, {
      method: "PUT",
      body: replacementBody,
    });
    assert.equal(updated.status, 200);
    const updatePayload = await updated.json() as {
      course_id: string;
      document_name: string;
      chunk_count: number;
    };
    assert.equal(updatePayload.course_id, courseId);
    assert.equal(updatePayload.document_name, "replacement.pdf");
    assert.equal(updatePayload.chunk_count, 1);
    assert.equal(updateCalls, 3);

    const invalid = await fetch(`${baseUrl}/api/courses/not-a-uuid`, { method: "DELETE" });
    assert.equal(invalid.status, 400);
    assert.equal(deleteCalls, 0);

    deleteResult = false;
    const missing = await fetch(`${baseUrl}/api/courses/${courseId}`, { method: "DELETE" });
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: `Course '${courseId}' was not found.` });

    deleteResult = true;
    const deleted = await fetch(`${baseUrl}/api/courses/${courseId}`, { method: "DELETE" });
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { deleted: true, course_id: courseId });

    const deletedAll = await fetch(`${baseUrl}/api/courses`, { method: "DELETE" });
    assert.equal(deletedAll.status, 200);
    assert.deepEqual(await deletedAll.json(), { deleted: true, deleted_count: 3 });
    assert.equal(deleteCalls, 2);
    assert.equal(deleteAllCalls, 1);

    const openApiResponse = await fetch(`${baseUrl}/openapi.json`);
    const openApi = await openApiResponse.json() as {
      paths: Record<string, Record<string, unknown>>;
    };
    assert.ok(openApi.paths["/api/courses"]?.delete);
    assert.ok(openApi.paths["/api/courses/{courseId}"]?.put);
    assert.ok(openApi.paths["/api/courses/{courseId}"]?.delete);

    console.log("API route tests passed: update, no-op, missing course, UUID validation, delete operations and OpenAPI paths.");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

await runApiRouteTests();
