# Development and Testing

## 1. Requirements

- Windows, macOS or Linux.
- Node.js 22.13.x or 24.0.0+.
- npm 10+ recommended.
- Internet access for installing npm dependencies and downloading the model snapshot.
- Sufficient local disk space for the BGE-M3 ONNX external-data file (approximately 2.27 GB).

Node.js 23.x is intentionally excluded by the package engine range.

## 2. Install dependencies

Run from `electron-rag-server`:

```bash
npm install --package-lock-only
npm ci
```

The first command creates the lockfile if it is not already present. Commit `package-lock.json` so later machines can use reproducible `npm ci` installs.

## 3. Configure local model files

The tokenizer and ONNX model are loaded from local directories. The default directory is `models/bge-m3-onnx` for both. See [models README](../models/README.md) and the root server README for the pinned download command.

The model loaders use local-files-only mode. Missing model files cause a clear load error; the application does not silently download model weights at runtime.

## 4. Build and test

```bash
npm run build
```

The build script runs the TypeScript compiler followed by the complete test suite.

Individual test commands:

| Command | Coverage |
| --- | --- |
| `npm run test:config` | Configuration behavior. |
| `npm run test:schema` | LanceDB/Arrow table schema. |
| `npm run test:duplicates` | Filename and content duplicate checks. |
| `npm run test:pipeline` | Course creation pipeline behavior. |
| `npm run test:pdf` | PDF.js adapter parsing. |
| `npm run test:repository` | LanceDB repository integration. |
| `npm run test:api` | HTTP route behavior. |
| `npm test` | Runs all test groups above. |

The PDF.js adapter test uses a small PDF fixture and does not require downloaded model weights. The full ingestion and semantic retrieval workflow requires local tokenizer and ONNX model files.

## 5. Start the service

Development mode:

```bash
npm run dev
```

Production-style local start after build:

```bash
npm start
```

Useful endpoints:

- Health: `http://localhost:3000/health`
- Swagger UI: `http://localhost:3000/docs`
- OpenAPI: `http://localhost:3000/openapi.json`

## 6. Windows one-click launcher

From the `electron-rag-server` directory, double-click `START-WINDOWS.bat`.

The launcher delegates to `scripts/setup-and-run-windows.ps1`, which:

1. Checks the supported Node.js and npm runtime.
2. Checks or installs Python and the Hugging Face CLI only if a model download is needed.
3. Checks the configured local model directories and downloads missing/incomplete pinned files.
4. Checks direct npm dependencies and runs `npm ci` if needed.
5. Runs `npm run build` (TypeScript compilation and tests).
6. Starts the server, or opens Swagger UI if a healthy instance is already responding.

Keep the launcher window open while using the server. Press Ctrl+C in that window to stop it. See the main [server README](../README.md) for model download details.

## 7. Test layers and interpretation

A passing unit or integration test proves only the behavior covered by that test. In particular:

- PDF parser tests do not prove that a new real-world PDF passes the configured validator.
- Embedding generation does not by itself prove LanceDB persistence.
- Successful ingestion proves that the pipeline and persistence path completed for that input.
- Retrieval tests should separately verify course filtering, active-generation filtering, hierarchy metadata, and empty/no-answer behavior.

For manual ingestion checks, use the actual API and inspect the returned course ID, page count, chunk count and embedding dimensions. Then retrieve the course and run targeted semantic queries.

## 8. Repository hygiene

Do not commit:

- `node_modules/`
- `dist/`
- `models/` model weights
- `data/` local LanceDB data
- `.env` files or credentials

Keep source, tests, lockfile and documentation under version control.
