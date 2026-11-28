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

These are TypeScript contracts, not a verified physical LanceDB schema yet.
Embedding generation is not integrated or runtime-verified, and no vectors
are written by this change. The next step is to validate the record types
against the installed LanceDB SDK and then implement table creation.
