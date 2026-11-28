# VDB Manager

The VDB manager exposes course lifecycle and semantic retrieval operations backed by embedded LanceDB. Provider-specific database access is isolated behind the repository and LanceDB table manager.

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

`CourseIdentityFactory` performs filename normalization, SHA-256 calculation, duplicate checks, and UUID assignment. The create/update workflow serializes writes within this server process so duplicate-check-to-persistence operations do not race locally.

## Course operations

| Operation | Service method | Behavior |
| --- | --- | --- |
| Create course | `createCourse` | Runs PDF parsing, validation, hierarchical extraction, chunking, embedding and persistence. |
| Replace course | `updateCourse` | Fully replaces a course while preserving its ID; identical filename and bytes are rejected as a no-op. |
| Delete course | `deleteCourse` | Removes the catalogue record and associated chunks. |
| Retrieve course | `getCourse` | Returns stored metadata and the parsed hierarchy, without loading the embedding model. |
| List courses | `getAllCourses` | Returns all stored course records. |
| Delete all courses | `deleteAllCourses` | Removes all catalogue records and associated chunks. |
| Semantic retrieval | `searchCourses` | Embeds a natural-language query and returns the nearest active-generation chunks. |

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

Omit `course_id` to search across all courses. Omit `top_k` to use the default. The API validates query text, UUID and result limit.

## Physical LanceDB schemas

`courses` stores course identity, normalized filename, SHA-256 fingerprint, complete serialized hierarchy, active chunk-generation ID, and timestamps.

`course_chunks` stores one chunk, its dense vector, exact embedding input, source text, heading path, token count, source page/line range, and embedding model metadata.

`course-table-manager.ts` creates both empty tables when absent and validates existing schemas when opening them. It does not silently migrate existing tables. Existing local databases created with an incompatible catalogue or chunk schema must be recreated or explicitly migrated before use.

## Transaction and generation behavior

LanceDB does not provide a cross-table transaction for this workflow. Creation writes chunk rows before publishing the course catalogue row and compensates on failure. Replacement writes a new generation, switches the catalogue to it, then removes old generations. Retrieval always filters by the active generation recorded in the catalogue.
