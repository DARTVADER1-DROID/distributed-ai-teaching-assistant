# BGE-M3 Embedding Service

A C++17 service that converts text into 1,024-dimensional, L2-normalized
BGE-M3 dense embeddings. It uses ONNX Runtime for CPU inference and
tokenizers-cpp to load the Hugging Face `tokenizer.json` file.

## Runtime design

- **Offline:** model and tokenizer are loaded from local filesystem paths.
  The service does not contact Hugging Face, GitHub, or any other network host.
- **No Python runtime:** inference and tokenization are performed from C++.
- **CPU baseline:** only ONNX Runtime's CPU execution provider is used.
- **No silent truncation:** text exceeding the configured sequence limit is
  rejected with an explicit error.
- **One shared tokenizer:** `countTokens()` uses the same tokenizer as
  `embedText()`, so the chunker can enforce the actual model token count.
- **No Qdrant dependency:** this service only creates embeddings. The VDB
  manager remains responsible for persistence and retrieval.

## Model files

The application must supply a compatible local BGE-M3 ONNX export and its
Hugging Face tokenizer file. The expected initial package layout is:

```text
models/
└── bge-m3/
    ├── model.onnx
    ├── model.onnx.data       # when the ONNX export uses external weights
    └── tokenizer.json
```

Keep external ONNX weight files beside the model using the exact filenames
referenced by the ONNX graph. Do not rename or separate them.

The service supports these ONNX dense-output contracts:

1. A float tensor shaped `[1, 1024]`, containing a sentence-level dense
   embedding.
2. A float tensor shaped `[1, sequence_length, 1024]`, containing encoder
   hidden states; the service uses the first (CLS) token vector.

The model must accept `input_ids` and may additionally accept
`attention_mask` and/or `token_type_ids`. The service checks this contract
during initialization and reports unsupported model inputs or outputs clearly.

The service normalizes the selected vector before returning it. The output is
always 1,024 float values suitable for cosine-similarity retrieval.

**Important:** BGE-M3 has multiple ONNX export layouts. Before bundling a
specific model artifact, verify its input names, output names, pooling
behavior, tokenizer parity, and numerical similarity against the original
BAAI BGE-M3 implementation. The service deliberately does not pretend that
an arbitrary ONNX export is equivalent merely because it loads successfully.

## Public API

```cpp
#include "embedding_service.hpp"

rag::EmbeddingConfig config;
config.model_path = "models/bge-m3/model.onnx";
config.tokenizer_path = "models/bge-m3/tokenizer.json";
config.max_sequence_length = 8192;
config.intra_op_threads = 0; // ONNX Runtime chooses the CPU thread count.

rag::EmbeddingService embedding_service(config);

const auto initialization = embedding_service.initialize();
if (!initialization.is_successful) {
    // Report initialization.error.
}

const auto embedding = embedding_service.embedText(
    "Heading path > Topic\nText to embed"
);

if (embedding.is_successful) {
    // embedding.dense_vector contains exactly 1024 normalized floats.
}

// Supply the exact same tokenizer to the structure-aware chunker:
rag::TokenCounter token_counter = [&](const std::string& text) {
    return embedding_service.countTokens(text);
};
```

Call `initialize()` once before `countTokens()` or `embedText()`.
Initialization errors and inference errors are returned explicitly.

For document ingestion, pass `DocumentChunk::embedding_text` to
`embedText()`, not just `DocumentChunk::text`. This preserves the heading
context already prepared by the chunker. Use the same embedding method and
model for user queries.

## Build dependencies

CMake acquires the pinned ONNX Runtime Windows x64 package and tokenizers-cpp
during the **build**. tokenizers-cpp uses Rust/Cargo to build its tokenizer
backend. These are build-machine requirements only.

The deployed application needs only its bundled application files, the local
BGE-M3 model/tokenizer assets, and the ONNX Runtime DLL. It does not need
Python, Rust, Cargo, CMake, Git, internet access, or a separately installed
ONNX Runtime.

The application packager must copy `onnxruntime.dll` beside the final EXE.
Use `rag_copy_embedding_runtime(your_application_target)` from this
CMake directory to do that for a CMake executable target.

The Windows build workflow compiles this service to catch integration errors.
It does not download or package the multi-gigabyte BGE-M3 model; model artifact
selection and numerical parity testing are a separate verification step.
