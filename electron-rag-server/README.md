# Electron RAG Server

A local Node.js/TypeScript RAG backend for PDF course ingestion, hierarchical
extraction, chunking, dense BGE-M3 embeddings, LanceDB persistence and semantic
retrieval. It exposes a REST API and Swagger UI for local development.

## Runtime requirements

- Node.js **22.13.x or 24.0.0+** (the supported runtime ranges for the pinned PDF.js release).
- npm 10 or newer is recommended. Node.js 23.x is intentionally excluded by PDF.js's declared engine range.
- Windows, macOS or Linux.
- The ONNX model files are downloaded separately and are not committed to Git.

Check the runtime before installing:

```bash
node --version
npm --version
```

## Install and run

Run these commands from this `electron-rag-server` directory:

```bash
npm install
npm run build
npm start
```

For development with automatic restart:

```bash
npm run dev
```

The first `npm install` resolves the pinned direct dependencies and creates
`package-lock.json` if it is not present. Keep that generated lockfile and use
`npm ci` for subsequent clean/reproducible installs. Do not delete the lockfile
after it has been generated.

The build command runs the TypeScript compiler and the complete test suite:
schema, duplicate detection, pipeline, real PDF.js parser integration,
LanceDB repository integration and HTTP API tests.

## Local BGE-M3 model setup

The server does not download model weights implicitly. Tokenization and
embedding use the **same pinned model snapshot**, so their tokenizer metadata
cannot silently drift apart. The default directory layout is:

```text
electron-rag-server/
├── models/
│   └── bge-m3-onnx/
│       ├── config.json
│       ├── tokenizer.json
│       ├── tokenizer_config.json
│       ├── special_tokens_map.json
│       └── onnx/
│           ├── model.onnx
│           └── model.onnx_data
└── ...
```

Install the Hugging Face CLI (Python is only needed for downloading model
files; the RAG server itself runs on Node.js):

```bash
python -m pip install -U huggingface_hub
```

Download the tokenizer metadata and ONNX graph from the exact immutable
revision configured in `config/config.ts`:

```bash
hf download onnx-community/bge-m3-ONNX config.json tokenizer.json tokenizer_config.json special_tokens_map.json onnx/model.onnx onnx/model.onnx_data --revision 25b9af8e87a38eb120cfe87125383677b9cd309e --local-dir ./models/bge-m3-onnx
```

The ONNX external tensor-data file is approximately 2.27 GB. Ensure the
download finishes completely; do not rename or separate `model.onnx` and
`model.onnx_data`. Transformers.js needs both files together.

The default model paths and immutable source revision are centralized in
`config/config.ts`. The downloaded directory is ignored by Git.

### Optional path overrides

Paths can be changed without editing source code:

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `MODEL_DIRECTORY` | `./models` | Root directory for local model folders |
| `TOKENIZER_MODEL_DIRECTORY` | `bge-m3-onnx` | Tokenizer folder under the model root |
| `EMBEDDING_MODEL_DIRECTORY` | `bge-m3-onnx` | ONNX model folder under the model root |
| `LANCEDB_URI` | `./data/lancedb` | Local LanceDB database directory |
| `PORT` | `3000` | HTTP server port |

Relative paths are resolved from the current working directory (normally this
package directory when using the commands above). Absolute paths are supported.
Remote model downloads are disabled by the model loaders; missing local files
produce a descriptive error instead of silently downloading weights.

## API

Once running:

- Health: http://localhost:3000/health
- Swagger UI: http://localhost:3000/docs
- OpenAPI JSON: http://localhost:3000/openapi.json

### Course operations

- `POST /api/courses` — create a course from a multipart PDF upload (`file`).
- `GET /api/courses` — list stored courses.
- `GET /api/courses/{courseId}` — retrieve course metadata and hierarchy.
- `PUT /api/courses/{courseId}` — fully replace a course from a multipart PDF upload.
- `DELETE /api/courses/{courseId}` — delete one course and its chunks.
- `DELETE /api/courses` — delete all courses and chunks.

### Semantic retrieval

`POST /api/retrieval/search` accepts JSON:

```json
{
  "query": "How are Laplace transforms used to solve differential equations?",
  "course_id": "optional-course-uuid",
  "top_k": 5
}
```

Omit `course_id` to search all courses. The query is embedded with the same
locally loaded BGE-M3 model used during ingestion. LanceDB searches only active
course generations and vectors produced by the configured embedding model.

## Tests

Run all tests:

```bash
npm test
```

Run the PDF.js adapter test independently:

```bash
npm run test:pdf
```

The PDF parser integration test creates a tiny valid PDF fixture in memory and
exercises the real PDF.js parser. It does not require a downloaded PDF fixture
or model weights. The model files are only required for real ingestion and
semantic retrieval requests.

## Local data and Git hygiene

- LanceDB data is written to `./data/lancedb` by default.
- Model weights live under `./models`.
- Both directories are ignored by Git.
- Do not commit model weights, local databases, `.env` files or
  `node_modules`.
- Keep `package-lock.json` under version control after the first dependency
  installation so future installs use the same resolved dependency tree.

## Known storage behavior

The VDB manager validates existing LanceDB table schemas and does not silently
migrate incompatible tables. If an old local database has a different schema,
back it up before removing it and starting with a fresh database directory.
