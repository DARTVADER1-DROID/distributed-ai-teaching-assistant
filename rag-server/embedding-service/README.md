# C# BGE-M3 Embedding Service

Embeds the `embedding_text` emitted by the existing C++ chunker. Each output
retains the chunk's source metadata and adds one 1024-dimensional dense vector.

## Runtime

- .NET 10
- ONNX Runtime CPU
- Hugging Face Tokenizers through Tokenizers.DotNet
- Prebuilt native tokenizer runtime assets are restored from NuGet. Rust is not
  required on the end-user machine or during this project's normal build.
- The project selects a native tokenizer package for the requested
  `RuntimeIdentifier`. The default build selects Windows x64.

## Model files

Use the CPU ONNX export of BAAI/bge-m3:

https://huggingface.co/a-ivanovitch/bge-m3-onnx

Place these files in a local model directory. They are intentionally not stored
in Git because the ONNX external weights are approximately 2.2 GB.

- `model_fp32.onnx`
- `model_fp32.onnx.data`
- `tokenizer_hf/tokenizer.json`

Download once during development/setup:

```powershell
hf download a-ivanovitch/bge-m3-onnx model_fp32.onnx model_fp32.onnx.data tokenizer_hf/tokenizer.json --local-dir .\models\bge-m3
```

The service itself makes no network requests. For offline distribution, bundle
the model directory beside the application or in its managed data directory.

## Usage

```csharp
using RagServer.EmbeddingService;

using var service = new EmbeddingService();
service.Initialize(new EmbeddingServiceOptions
{
    ModelPath = @".\models\bge-m3\model_fp32.onnx",
    ModelWeightsPath = @".\models\bge-m3\model_fp32.onnx.data",
    TokenizerJsonPath = @".\models\bge-m3\tokenizer_hf\tokenizer.json",
    BatchSize = 8,
    MaxSequenceLength = 1024
});

EmbeddingResult result = service.Embed(chunkingResult);
if (!result.IsSuccessful)
{
    Console.Error.WriteLine(result.Error);
    return;
}

foreach (EmbeddedChunk chunk in result.Chunks)
    Console.WriteLine($"Chunk {chunk.Index}: {chunk.Embedding.Length} dimensions");
```

## Behavior

- Embeds `DocumentChunk.EmbeddingText`, including heading context.
- Preserves index, original text, heading path, and PDF page/line positions.
- Batches inference to reduce per-call overhead.
- Uses the Hugging Face tokenizer JSON, including its XLM-RoBERTa special-token
  post-processor.
- Rejects chunks over 1024 tokens; it never silently truncates content.
- Returns an all-or-nothing result, not partial vectors after a failed batch.
- Validates finite values and returns L2-normalized 1024-dimensional vectors.

## Integration boundary

`ChunkingResult` and `DocumentChunk` are C# DTOs mirroring the C++ chunker
contract. This change does not modify the C++ validator, extractor, or chunker,
and does not yet add the C++/C# transport bridge.
