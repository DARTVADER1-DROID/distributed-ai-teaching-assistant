# VDB Manager

The VDB manager exposes course-level operations backed by LanceDB. The
provider-specific connection is isolated in `lance-db-client.ts`; course
operations will use that client rather than importing the SDK directly.

## Database connection

- SDK: `@lancedb/lancedb` (pinned to `0.41.0`).
- Default local database URI: `./data/lancedb`.
- Override the URI with the `LANCEDB_URI` environment variable.
- The client lazily opens one connection and shares it across operations.
- LanceDB's embedded mode stores its data in the configured local directory;
  it does not require a separate database server.

## Course contract

- `course_id` is the unique course identifier.
- `material` contains the complete `ExtractionResult` produced by the
  extraction pipeline.
- Creating an existing `course_id` must fail with
  `CourseAlreadyExistsError`; create must never overwrite.
- Updating a course replaces its entire extracted material. It is not a
  partial update or merge.

## Operations

| Operation | File | Contract |
| --- | --- | --- |
| Create course | `create-course.ts` | Create only if the ID does not exist; otherwise throw a duplicate error. |
| Update course | `update-course.ts` | Replace all extracted material for the given ID. |
| Delete course | `delete-course.ts` | Delete one course by ID. |
| Retrieve course | `get-course.ts` | Return one course by ID, or null when absent. |
| Show all courses | `get-all-courses.ts` | Return all stored courses. |
| Delete all courses | `delete-all-courses.ts` | Remove all stored courses. |

Course operation bodies remain intentionally unimplemented. The persisted record contracts are defined in `storage-records.ts`:

- `CourseRecord` stores the complete serialized `ExtractionResult`, the active
  chunk-generation ID, and creation/update timestamps.
- `CourseChunkRecord` stores one chunk, its dense vector, exact embedding input,
  source text, heading path, token count, source page/line range, and embedding
  model metadata. The heading path is JSON-encoded as a scalar column.
- `serializeCourseMaterial` and `deserializeCourseMaterial` keep the boundary
  between the domain extraction type and the persisted JSON representation
  explicit.

## Physical LanceDB schemas

`course-table-schemas.ts` defines explicit Apache Arrow schemas for both tables.
The `course_chunks.vector` column is a fixed-size list of 1024 Float32 values,
matching the current BGE-M3 embedding service contract. All chunk provenance
fields use the exact names from `DocumentChunk`.

`course-table-manager.ts` creates the two empty tables when absent and opens
them when already present. It checks existing column names and Arrow types
before returning handles; it does not overwrite or silently migrate existing
tables. The manager caches its initialization promise so concurrent callers
share one initialization attempt.

The LanceDB SDK `0.41.0` declares Apache Arrow as a peer dependency. The server
now pins `apache-arrow` to `21.2.0`, matching the SDK's own development version.

Embedding generation is not yet integrated or runtime-verified. The physical
vector column is defined, but this change does not write or index vectors.
