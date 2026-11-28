# Storage and Data Model

## 1. Database location

The server uses the embedded LanceDB SDK. The default URI is `./data/lancedb`; `LANCEDB_URI` overrides it. Relative paths are resolved from the process working directory.

No separate database server is required for the default filesystem URI.

## 2. Tables

The database contains two tables: `courses` and `course_chunks`.

### 2.1 `courses`

One row per course.

| Field | Arrow type | Meaning |
| --- | --- | --- |
| `course_id` | Utf8 | Generated course UUID. |
| `document_name` | Utf8 | Normalized display basename of uploaded filename. |
| `document_name_key` | Utf8 | Lower-case uniqueness key. |
| `document_hash` | Utf8 | SHA-256 of exact uploaded bytes. |
| `material_json` | Utf8 | Serialized complete extraction result/tree. |
| `active_generation_id` | Utf8 | Generation currently exposed to retrieval. |
| `created_at` | Utf8 | ISO-8601 creation timestamp. |
| `updated_at` | Utf8 | ISO-8601 last replacement timestamp. |

### 2.2 `course_chunks`

One row per chunk within a course generation.

| Field | Arrow type | Meaning |
| --- | --- | --- |
| `chunk_id` | Utf8 | Unique chunk-row UUID. |
| `course_id` | Utf8 | Owning course UUID. |
| `generation_id` | Utf8 | Course generation that produced this row. |
| `chunk_index` | Int32 | Zero-based position in the generation. |
| `vector` | FixedSizeList(Float32, 1024) | Dense normalized embedding. |
| `embedding_model_id` | Utf8 | Model identifier used to generate the vector. |
| `embedding_dimensions` | Int32 | Vector dimensionality (1024). |
| `content` | Utf8 | Original chunk text, without synthetic heading prefix. |
| `embedding_text` | Utf8 | Heading context plus original content, used as embedding input. |
| `heading_path_json` | Utf8 | JSON array of heading titles from root to current section. |
| `token_count` | Int32 | Token count of the complete embedding input. |
| `start_page_number` | Int32 | First source page. |
| `start_line_number` | Int32 | First source line. |
| `end_page_number` | Int32 | Last source page. |
| `end_line_number` | Int32 | Last source line. |

The schema is defined in `vdb-manager/course-table-schemas.ts`.

## 3. Course identity and duplicate policy

- Course IDs are generated as UUID v4 values.
- Filename normalization strips directory components for both Windows and POSIX separators, trims whitespace, normalizes Unicode to NFC and compares a lower-case key.
- The exact PDF bytes are hashed using SHA-256.
- A matching normalized filename is rejected.
- A matching exact-byte hash is rejected.
- The duplicate check excludes the course being updated.
- An update is a no-op only when both normalized filename and exact-byte hash match the current course.

The hash is not a semantic PDF fingerprint. Re-exported PDFs with changed internal bytes may not be identified as duplicates.

## 4. Generation lifecycle

Each create or replacement operation assigns a new generation UUID to its chunk rows.

### Create

1. Process and embed the complete document.
2. Write all chunk rows using a new generation ID.
3. Insert the course catalogue row with that generation as active.
4. If catalogue insertion fails, attempt to delete the newly written chunk rows.

### Replace

1. Load the existing course and check whether the request is a no-op.
2. Process and embed the replacement document.
3. Write replacement chunk rows under a new generation ID.
4. Replace the catalogue record, preserving the course ID and creation timestamp while updating document metadata, hierarchy, active generation and update timestamp.
5. Delete rows belonging to older generations.

The repository attempts compensating cleanup and rollback if the catalogue replacement fails. LanceDB does not provide a cross-table transaction here, so the workflow is not fully atomic. A cleanup error after the catalogue switch can leave old inactive rows in storage.

### Delete one / delete all

The repository removes catalogue rows first, then removes associated chunk rows. This avoids exposing a course as current if chunk cleanup fails. Retrying deletion can finish cleaning up orphaned rows.

## 5. Retrieval filtering

Before vector search, the repository reads the course catalogue:

- If a course ID is supplied, it loads that course or reports not found.
- Otherwise, it loads all course records.
- It constructs a predicate containing each course ID and its active generation ID.
- It additionally filters by the query embedding's model ID.

LanceDB performs cosine-distance search on the vector field. Results include the chunk content and metadata; the current course document name is joined from the catalogue records.

This active-generation filter is important: stale or orphaned rows are not treated as current content merely because they remain physically present.

## 6. Schema compatibility and migrations

At initialization, `CourseTableManager` creates missing tables or opens existing tables and compares their column count, order, names and Arrow type strings with the expected schema.

The application does **not** automatically migrate incompatible tables. If a schema mismatch is reported:

1. Stop the server.
2. Back up the existing database directory.
3. Determine whether the data must be preserved.
4. Apply an explicit migration or start with a new empty database directory.

Do not delete the database directory without checking whether it contains course data that must be retained.
