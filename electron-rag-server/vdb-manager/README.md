# VDB Manager

The VDB manager exposes course-level operations backed by embedded LanceDB.
The provider-specific connection is isolated in `lance-db-client.ts`.

## Database connection

- SDK: `@lancedb/lancedb` (pinned to `0.41.0`).
- Default local database URI: `./data/lancedb`.
- Override the URI with the `LANCEDB_URI` environment variable.
- One lazily opened connection is shared across operations.
- A filesystem URI uses embedded storage and does not require a separate database server.

## Course identity and duplicate policy

- Course IDs are generated automatically as UUID v4 values; callers do not supply IDs.
- The original uploaded filename is stored for display.
- Filename uniqueness is case-insensitive and compares the normalized basename (directory components are ignored).
- The exact uploaded bytes are fingerprinted with SHA-256.
- An existing normalized filename is rejected, even if the new file has different contents.
- An existing SHA-256 fingerprint is rejected, even if the new file has a different filename.
- A different filename with different bytes is allowed.
- SHA-256 detects byte-identical files, not visually or semantically identical PDFs re-exported with changed metadata.

`CourseIdentityFactory` performs filename normalization, SHA-256 calculation, duplicate checks, and UUID assignment. It prepares identity metadata only; it does not run the PDF pipeline or persist a course.

**Concurrency requirement:** LanceDB has no relational unique constraints or multi-table transaction for this workflow. The eventual `CreateCourse` implementation must serialize the entire duplicate-check-to-course-insert operation. A check alone is not an atomic reservation across multiple processes.

## Course contract

- `Course` is the stored domain object and includes its generated ID, document name, SHA-256 hash, and complete `ExtractionResult`.
- `CreateCourseRequest` contains the uploaded filename and bytes; it has no ID or caller-supplied hash.
- Updating a course will replace its complete extracted material, not merge partial content.

## Operations

| Operation | File | Contract |
| --- | --- | --- |
| Create course | `create-course.ts` | Planned orchestration point for identity checks, processing, and persistence. |
| Update course | `update-course.ts` | Replace all extracted material for the given ID. |
| Delete course | `delete-course.ts` | Delete one course by ID. |
| Retrieve course | `get-course.ts` | Return one course by ID, or null when absent. |
| Show all courses | `get-all-courses.ts` | Return all stored courses. |
| Delete all courses | `delete-all-courses.ts` | Remove all stored courses. |

The PDF validator, extractor, chunker, and embedder are not wired into `CreateCourse` in this change.

## Physical LanceDB schemas

`courses` stores course identity, normalized filename, SHA-256 fingerprint, complete serialized hierarchy, active chunk-generation ID, and timestamps.

`course_chunks` stores one chunk, its dense vector, exact embedding input, source text, heading path, token count, source page/line range, and embedding model metadata. The vector column is a fixed-size list matching the embedding service's declared dimensions.

`course-table-manager.ts` creates both empty tables when absent and validates existing schemas when opening them. It does not silently migrate existing tables. Existing local databases created with the previous catalogue schema must be recreated or explicitly migrated before use with this schema.
