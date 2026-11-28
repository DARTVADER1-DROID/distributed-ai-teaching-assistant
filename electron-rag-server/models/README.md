# Local BGE-M3 model files

The application uses one pinned Hugging Face snapshot for both tokenization
and ONNX embedding. This keeps the tokenizer metadata and model weights
version-aligned. Downloaded files are intentionally excluded from Git.

Expected layout:

```text
models/
└── bge-m3-onnx/
    ├── config.json
    ├── tokenizer.json
    ├── tokenizer_config.json
    ├── special_tokens_map.json
    └── onnx/
        ├── model.onnx
        └── model.onnx_data
```

The repository ID and immutable revision are centralized in
`config/config.ts`. See the server README for the exact download command.
