# Local model files

This directory contains model files downloaded on the developer's machine.
The model weights are intentionally excluded from Git.

Expected layout:

```text
models/
├── bge-m3-tokenizer/
│   ├── tokenizer.json
│   ├── tokenizer_config.json
│   └── special_tokens_map.json
└── bge-m3-onnx/
    ├── config.json
    ├── tokenizer.json
    ├── tokenizer_config.json
    ├── special_tokens_map.json
    └── onnx/
        ├── model.onnx
        └── model.onnx_data
```

Use the exact revisions listed in `config/config.ts`. See the server README
for the download commands and the local configuration overrides.
