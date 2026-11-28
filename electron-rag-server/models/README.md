# Local BGE-M3 model files

The server uses one pinned Hugging Face snapshot for both tokenization and ONNX embedding. Keeping the tokenizer metadata and model graph on the same immutable revision prevents tokenizer/model version drift. Downloaded model files are intentionally excluded from Git.

## Model source

| Setting | Value |
| --- | --- |
| Hugging Face repository | `onnx-community/bge-m3-ONNX` |
| Revision | `25b9af8e87a38eb120cfe87125383677b9cd309e` |
| Embedding dimensions | 1024 |
| Tokenizer | XLM-RoBERTa tokenizer shipped with BGE-M3 |
| Embedding runtime | Transformers.js with local ONNX files |
| Pooling | CLS |
| Normalization | Enabled |

The repository ID and immutable revision are centralized in `config/config.ts`. The model loaders use `local_files_only: true`; they do not download model weights during server startup or inference.

## Expected directory layout

Default paths are `MODEL_DIRECTORY=./models`, `TOKENIZER_MODEL_DIRECTORY=bge-m3-onnx`, and `EMBEDDING_MODEL_DIRECTORY=bge-m3-onnx`.

```text
electron-rag-server/
└── models/
    └── bge-m3-onnx/
        ├── config.json
        ├── tokenizer.json
        ├── tokenizer_config.json
        ├── special_tokens_map.json
        └── onnx/
            ├── model.onnx
            └── model.onnx_data
```

Required files:

- `config.json`
- `tokenizer.json`
- `tokenizer_config.json`
- `special_tokens_map.json`
- `onnx/model.onnx`
- `onnx/model.onnx_data`

Do not rename, move apart, or omit `model.onnx` and `model.onnx_data`; the ONNX graph references the external tensor-data file.

## Download

From the `electron-rag-server` directory, install the Hugging Face CLI:

```bash
python -m pip install -U huggingface_hub
```

Download the exact configured snapshot:

```bash
hf download onnx-community/bge-m3-ONNX config.json tokenizer.json tokenizer_config.json special_tokens_map.json onnx/model.onnx onnx/model.onnx_data --revision 25b9af8e87a38eb120cfe87125383677b9cd309e --local-dir ./models/bge-m3-onnx
```

The ONNX external-data file is approximately 2.27 GB. Ensure sufficient free disk space and a reliable connection. The Windows launcher performs the same download automatically when required files are absent or incomplete.

## Separate tokenizer and embedding directories

The configuration supports separate directories:

- `TOKENIZER_MODEL_DIRECTORY`
- `EMBEDDING_MODEL_DIRECTORY`

If the paths differ, each configured directory is checked/downloaded independently by the Windows launcher using its corresponding model ID and revision. If both paths are the same, the configured tokenizer and embedding repository/revision must also match.

## Related configuration

| Setting | Default | Purpose |
| --- | --- | --- |
| `MODEL_DIRECTORY` | `./models` | Root containing local model folders. |
| `TOKENIZER_MODEL_DIRECTORY` | `bge-m3-onnx` | Tokenizer directory under the model root. |
| `EMBEDDING_MODEL_DIRECTORY` | `bge-m3-onnx` | ONNX model directory under the model root. |
| `max_chunk_tokens` | `512` | Application-level maximum complete embedding input, including heading context and special tokens. |
| Embedding batch size | `8` | Default batch size in `EmbeddingService.load`. |

The model services declare a maximum sequence length of 8192, but the application's chunker uses the separate 512-token default. The application-level chunk budget is the limit applied during ingestion.

## Verification and troubleshooting

The Windows launcher checks that all required files exist and applies minimum-size checks to the large tokenizer and ONNX files. These checks catch missing, empty or obviously incomplete downloads; they are not a cryptographic checksum verification of every downloaded file.

If loading fails:

1. Check the configured model paths and revision in `config/config.ts`.
2. Confirm that all six required files exist.
3. Confirm that `model.onnx` and `model.onnx_data` are together under `onnx/`.
4. Rerun `START-WINDOWS.bat` to trigger missing/incomplete-file checks.
5. If necessary, remove only the incomplete model snapshot and download it again; do not remove the LanceDB data directory as a model repair step.

## Git hygiene

The model directory is local runtime data and must not be committed. Keep the directory ignored by Git. See [DEVELOPMENT.md](../docs/DEVELOPMENT.md) and [TROUBLESHOOTING.md](../docs/TROUBLESHOOTING.md).
