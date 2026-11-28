# HTTP API Reference

Base URL for local development: `http://localhost:3000` (override the port with `PORT`).

Interactive documentation is served at `/docs`; the OpenAPI document is at `/openapi.json`.

## Conventions

- JSON request and response bodies use UTF-8.
- PDF uploads use `multipart/form-data` with a single field named `file`.
- Maximum upload size: 25 MiB; exactly one uploaded file is accepted per request.
- Course identifiers are UUIDs.
- Error responses use an object with an `error` string and optional `details`.
- The server currently exposes the routes listed below.

## Health

### `GET /health`

Returns:

```json
{ "status": "ok" }
```

HTTP 200 indicates that the HTTP service responds. It does not independently prove that the model files can be loaded or that a LanceDB query will succeed.

## Courses

### `POST /api/courses` — create a course

Content type: `multipart/form-data`

| Field | Type | Required | Constraint |
| --- | --- | --- | --- |
| `file` | PDF file | Yes | Maximum 25 MiB; one file |

Successful response: HTTP 201.

```json
{
  "course_id": "generated-uuid",
  "document_name": "power-electronics.pdf",
  "page_count": 12,
  "chunk_count": 38,
  "embedding_output": {
    "model_id": "onnx-community/bge-m3-ONNX",
    "dimensions": 1024,
    "vector_count": 38,
    "sample_vector": [0.01, -0.02]
  }
}
```

The vector array shown above is abbreviated for illustration; the actual `sample_vector` contains 1024 values.

Relevant responses:

| Status | Meaning |
| --- | --- |
| 201 | Course processed and persisted. |
| 400 | Missing file or malformed request. |
| 409 | Duplicate filename or exact file content. |
| 413 | Upload exceeds 25 MiB. |
| 422 | PDF validation, extraction, chunking or embedding failed. |
| 500 | Unexpected server or persistence failure. |

### `GET /api/courses` — list courses

Returns an array of course records. Each record contains:

- `course_id`
- `document_name`
- `document_hash`
- `active_generation_id`
- `created_at`
- `updated_at`
- `material`: the hierarchical extraction result

An empty catalogue returns an empty array.

### `GET /api/courses/{courseId}` — retrieve a course

Returns one course record with its hierarchical extraction result. It does not return original PDF bytes, chunk rows or embedding vectors, and it does not need to initialize the embedding model.

| Status | Meaning |
| --- | --- |
| 200 | Course found. |
| 400 | Course ID is not a valid UUID. |
| 404 | Course does not exist. |
| 500 | Stored data is corrupted or the database is unavailable. |

### `PUT /api/courses/{courseId}` — fully replace a course

Content type: `multipart/form-data`, field `file` (one PDF, maximum 25 MiB).

This operation replaces the document name, content fingerprint, extracted hierarchy and active chunk generation while preserving the original course ID.

The replacement PDF must pass the complete ingestion pipeline before the catalogue is switched to the new generation. If processing fails before persistence, the existing course remains active. A request with both the same normalized filename and identical file bytes is rejected as a no-op.

| Status | Meaning |
| --- | --- |
| 200 | Replacement completed. |
| 400 | Invalid course ID or missing file. |
| 404 | Course does not exist. |
| 409 | Duplicate document or no-op update. |
| 413 | Upload exceeds 25 MiB. |
| 422 | Replacement failed validation, extraction, chunking or embedding. |
| 500 | Unexpected persistence failure. If post-switch cleanup fails, the new generation may already be active while stale inactive chunks remain. |

The repository uses compensating operations rather than a cross-table transaction. See [ARCHITECTURE.md](./ARCHITECTURE.md).

### `DELETE /api/courses/{courseId}` — delete one course

Permanently removes the course catalogue entry and all associated chunk rows.

| Status | Meaning |
| --- | --- |
| 200 | Deletion completed; response contains `deleted: true` and `course_id`. |
| 400 | Course ID is not a valid UUID. |
| 404 | Course does not exist. |
| 500 | Deletion failed. |

### `DELETE /api/courses` — delete all courses

Permanently removes every course catalogue entry and all associated chunk rows.

Successful response:

```json
{
  "deleted": true,
  "deleted_count": 3
}
```

The count is the number of catalogue records present before deletion.

## Retrieval

### `POST /api/retrieval/search` — semantic search

Content type: `application/json`

Request:

```json
{
  "query": "Explain the operation of a buck converter.",
  "course_id": "optional-course-uuid",
  "top_k": 5
}
```

| Field | Type | Required | Constraint / default |
| --- | --- | --- | --- |
| `query` | string | Yes | Non-empty; maximum 8000 characters |
| `course_id` | UUID string | No | Restricts search to one course |
| `top_k` | integer | No | Default 5; range 1–50 |

Successful response:

```json
{
  "query": "Explain the operation of a buck converter.",
  "course_id": null,
  "top_k": 5,
  "results": [
    {
      "chunk_id": "chunk-uuid",
      "course_id": "course-uuid",
      "document_name": "power-electronics.pdf",
      "chunk_index": 4,
      "content": "A buck converter reduces the input voltage...",
      "heading_path": [
        "Power Electronics",
        "DC-DC Converters",
        "Buck Converter"
      ],
      "token_count": 164,
      "start_page_number": 4,
      "start_line_number": 12,
      "end_page_number": 4,
      "end_line_number": 19,
      "distance": 0.31
    }
  ]
}
```

The example values are illustrative. Actual distances depend on the query, corpus and embedding model. Lower cosine distance indicates a closer vector match; it is not a probability.

| Status | Meaning |
| --- | --- |
| 200 | Search completed; results may be empty. |
| 400 | Invalid/empty query, invalid UUID or invalid `top_k`. |
| 404 | The requested course does not exist. |
| 500 | Query embedding or vector search failed. |

Omitting `course_id` searches all courses. Retrieval is restricted to each course's active generation and the configured embedding model ID.

## OpenAPI and Swagger

- Swagger UI: `GET /docs`
- OpenAPI JSON: `GET /openapi.json`

The OpenAPI document is currently defined in `main.ts`. Keep this guide and the OpenAPI document synchronized when routes, payloads or status codes change.
