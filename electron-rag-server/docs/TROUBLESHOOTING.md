# Troubleshooting

## Node.js version rejected

**Symptom:** The launcher reports an unsupported Node.js version.

**Cause:** The package supports Node.js 22.13.x or 24.0.0+. Node.js 23.x is excluded.

**Action:** Install a supported Node.js LTS release, open a new terminal so PATH refreshes, and rerun the launcher.

## npm dependency check fails

**Symptom:** The launcher reports missing or inconsistent dependencies.

**Action:**

```cmd
npm ci
npm run build
```

If npm reports a nested optional dependency mismatch, inspect the exact dependency tree before changing versions. Do not use `npm audit fix --force` as a generic repair; it can introduce breaking version changes. The launcher checks top-level dependencies with `npm ls --depth=0`.

## Hugging Face CLI is missing

**Symptom:** The launcher cannot find `hf`.

**Action:** Ensure Python is installed, then run:

```cmd
python -m pip install --user -U huggingface_hub
```

If the command installs successfully but `hf` is not recognized, add the Python user Scripts directory to PATH or open a new terminal and retry.

## Model download is incomplete or fails

**Symptom:** Required model files are missing or smaller than expected.

**Cause:** The download may have been interrupted, disk space may be insufficient, or the network connection may have failed.

**Action:**

1. Check free disk space (the ONNX external-data file is approximately 2.27 GB).
2. Confirm the model directory and revision in `config/config.ts`.
3. Rerun `START-WINDOWS.bat`; it checks the required files and retries missing/incomplete downloads.
4. Do not rename or separate `model.onnx` and `model.onnx_data`.

The runtime model loaders use local files only and do not download missing weights implicitly.

## Tokenizer or ONNX model cannot load

**Symptom:** Ingestion or retrieval reports that the local BGE-M3 tokenizer/model cannot be loaded.

**Check:**

- `config.json`
- `tokenizer.json`
- `tokenizer_config.json`
- `special_tokens_map.json`
- `onnx/model.onnx`
- `onnx/model.onnx_data`

Confirm that the tokenizer and embedding paths point to the intended model snapshot and that the configured repository revisions match the downloaded files. If you use separate directories, both must contain the appropriate files.

## PDF rejected by validation

**Symptom:** The API returns HTTP 422 with page/line validation issues.

**Action:** Read [VALIDATOR-GUIDE.md](../VALIDATOR-GUIDE.md). Common causes include:

- Heading font size does not match configured H1-H6 sizes.
- Paragraphs use inconsistent font sizes.
- Decorative text introduces unsupported font sizes.
- A heading level skips a level.
- A sibling heading starts before the previous heading is closed.
- A parent is closed before its descendants.
- An `End of topic.` line uses body font size instead of the matching heading size.
- A heading remains open at end-of-file.

The closure marker must be its own extracted line, with exact text `End of topic.`, at the same configured font size as the heading it closes. Page breaks do not close headings.

## PDF parsing fails

**Symptom:** The upload is rejected as an invalid or unreadable PDF.

**Check:**

- The upload is actually a PDF and is not empty.
- The PDF is not encrypted/password-protected.
- The file is not truncated or corrupted.
- The upload is below 25 MiB.

A valid PDF signature or successful creation by a PDF library does not guarantee that PDF.js can extract usable text and font metadata.

## Chunking fails

**Symptom:** The pipeline reports a missing tokenizer, invalid token count, or chunk exceeding the configured limit.

**Check:**

- The local tokenizer snapshot is present and loadable.
- The tokenizer revision matches the configured model revision.
- `max_chunk_tokens` is a positive integer.
- The complete heading-aware embedding input fits the token budget.

The chunk budget includes heading context and special tokens. A very long heading path reduces the amount of paragraph content available in a chunk.

## Embedding fails or dimensions are invalid

**Symptom:** The embedding stage fails or returns the wrong number/dimension of vectors.

**Check:**

- ONNX model files are complete.
- Model ID/revision and local path are correct.
- Each chunk's embedding text is non-empty.
- Returned vectors are finite and exactly 1024-dimensional.

The embedding service uses CLS pooling and normalized vectors. The pipeline rejects a result whose vector count does not match the chunk count.

## LanceDB schema mismatch

**Symptom:** Startup reports an incompatible column count, name, order or Arrow type.

**Cause:** The existing local database was created with a different schema.

**Action:**

1. Stop the server.
2. Back up the database directory.
3. Decide whether its data must be migrated or can be recreated.
4. Apply a deliberate migration or configure a new empty `LANCEDB_URI`.

The application does not silently migrate existing LanceDB tables. Do not delete the database before backing up valuable course data.

## Port is already in use

**Symptom:** The launcher reports that the configured port is occupied but the RAG health endpoint does not respond.

**Action:** Stop the process using the port, or choose another port:

```cmd
set PORT=3100
npm start
```

The Windows launcher reads the `PORT` environment variable when checking the health endpoint and starting the service.

## Health endpoint responds but ingestion fails

**Explanation:** `GET /health` confirms only that the HTTP service responds. It does not validate model availability, database schema compatibility for every operation, or successful PDF processing.

**Action:** Check the exact API error and server output. Verify model files, LanceDB path/schema, and the PDF validator report independently.
