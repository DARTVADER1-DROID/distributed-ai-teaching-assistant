# VDB Manager

The VDB manager is the application layer for course lifecycle operations and semantic retrieval. It coordinates the ingestion pipeline and isolates LanceDB access behind the table manager and repository.

## Documentation map

- [System architecture](../docs/ARCHITECTURE.md)
- [Ingestion and retrieval pipeline](../docs/PIPELINE.md)
- [HTTP API reference](../docs/API.md)
- [Storage schema and generation lifecycle](../docs/DATA-MODEL.md)
- [Development and testing](../docs/DEVELOPMENT.md)
- [Troubleshooting](../docs/TROUBLESHOOTING.md)

## Database connection

- SDK: `@lancedb/lancedb` (pinned to `0.41.0`).
- Default local database URI: `./data/lancedb`.
- Override the URI with the `LANCEDB_URI` environment variable.
- One lazily opened connection is shared across operations.
- A filesystem URI uses embedded storage and does not require a separate database server.

## Course identity and duplicate policy

- Course IDs are generated automatically as UUID v4 values; callers do not supply IDs.
- The uploaded filename is reduced to its basename, trimmed, Unicode NFC-normalized, and retained as the display name.
- Filename uniqueness is case-insensitive and compares the normalized basename; Windows and POSIX directory separators are both handled.
- The exact uploaded bytes are fingerprinted with SHA-256.
- An existing normalized filename is rejected, even if the new file has different contents.
- An existing SHA-256 fingerprint is rejected, even if the new file has a different filename.
- A different filename with different bytes is allowed.
- SHA-256 detects byte-identical files, not visually or semantically identical PDFs re-exported with changed metadata.

`CourseIdentityFactory` performs filename normalization, SHA-256 calculation, duplicate checks, and UUID assignment. `VdbManagerService` serializes write operations within this server process so duplicate-check-to-persistence operations do not race locally. This is not a distributed lock across multiple server processes.

## Course operations

| Operation | Service method | Behavior |
| --- | --- | --- |
| Create course | `createCourse` | Runs PDF parsing, validation, hierarchical extraction, chunking, embedding and persistence. |
| Replace course | `updateCourse` | Fully replaces a course while preserving its ID; identical normalized filename and bytes are rejected as a no-op. |
| Delete course | `deleteCourse` | Removes the catalogue record and associated chunks. |
| Retrieve course | `getCourse` | Returns stored metadata and parsed hierarchy, without loading the embedding model. |
| List courses | `getAllCourses` | Returns all stored course records. |
| Semantic retrieval | `searchCourses` | Embeds a natural-language query and returns nearest active-generation chunks. |
| Delete all courses | `deleteAllCourses` | Removes all catalogue records and associated chunks. |

## Semantic retrieval

The retrieval operation embeds the query using the same BGE-M3 ONNX model and embedding configuration used during ingestion. The embedding model is loaded lazily and shared between ingestion and query embedding.

LanceDB performs cosine-distance vector search over the `course_chunks` table. The repository first reads the course catalogue and filters candidates by each course's `active_generation_id` and the query embedding model ID. This prevents superseded generations and incompatible embedding models from being returned.

Search can cover all courses or be restricted to one course. `top_k` defaults to 5 and is limited to 1–50. Results include chunk content, heading path, token count, document name, source page/line range, and cosine distance (lower is closer). No match returns an empty results array.

HTTP endpoint: `POST /api/retrieval/search`

```json
{
  "query": "How are Laplace transforms used to solve differential equations?",
  "course_id": "optional-course-uuid",
  "top_k": 5
}
```

Omit `course_id` to search all courses. Omit `top_k` to use the default. The API validates query text, UUID and result limit.

## Physical LanceDB schemas

The `courses` table stores one row per course:

- `course_id`, `document_name`, `document_name_key`
- `document_hash` (SHA-256 of exact uploaded bytes)
- `material_json` (serialized extraction tree)
- `active_generation_id`
- `created_at`, `updated_at`

The `course_chunks` table stores one row per chunk generation entry:

- Chunk, course and generation IDs; zero-based chunk index.
- Fixed-size 1024-dimensional Float32 vector.
- Embedding model ID and dimensions.
- Original chunk content and exact embedding input.
- JSON heading path, token count and source page/line range.

The authoritative Arrow schemas are in `course-table-schemas.ts`; the complete field table is in [DATA-MODEL.md](../docs/DATA-MODEL.md).

`course-table-manager.ts` creates missing tables and validates existing schemas when opening them. It checks column count, order, names and Arrow types. It does not silently migrate existing tables. Existing local databases with incompatible schemas must be backed up and explicitly migrated or replaced with a new database directory.

## Transaction and generation behavior

LanceDB does not provide a cross-table transaction for this workflow.

- **Create:** chunk rows are written before the catalogue record. If catalogue insertion fails, the repository attempts to delete the new chunk generation.
- **Replace:** a new generation is written, the catalogue is switched to it, then old-generation chunks are deleted. If the catalogue switch fails, the repository attempts to restore the prior catalogue record and remove the new generation.
- **Delete:** the catalogue row is removed before associated chunks. Retrying can clean up orphaned chunks if an earlier cleanup failed.
- **Retrieval:** only the active generation recorded in the catalogue is searched.

These are compensating operations, not an atomic transaction. A failure during post-switch cleanup can leave stale inactive rows physically stored; active-generation filtering prevents those rows from appearing as current search results.
