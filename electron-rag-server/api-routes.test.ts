import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { createApp } from "./main.js";
import type { VdbManagerService } from "./vdb-manager/vdb-manager-service.js";

async function runApiDeleteTests(): Promise<void> {
  const courseId = "7a1a3a84-3fd7-4d75-a75d-6adca39b7f8d";
  let deleteResult = true;
  let deleteAllResult = 3;
  let deleteCalls = 0;
  let deleteAllCalls = 0;

  const manager = {
    async createCourse() { throw new Error("Not used in this test."); },
    async updateCourse() { throw new Error("Not used in this test."); },
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
    assert.ok(openApi.paths["/api/courses/{courseId}"]?.delete);

    console.log("API delete tests passed: UUID validation, missing course, single deletion, delete-all and OpenAPI paths.");
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

await runApiDeleteTests();
