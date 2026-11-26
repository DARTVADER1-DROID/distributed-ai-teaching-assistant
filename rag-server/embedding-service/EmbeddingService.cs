using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using Tokenizers.DotNet;

namespace RagServer.EmbeddingService;

/// <summary>Mirrors the successful result from the existing C++ chunker.</summary>
public sealed class ChunkingResult
{
    public bool IsSuccessful { get; init; }
    public string Error { get; init; } = string.Empty;
    public IReadOnlyList<DocumentChunk> Chunks { get; init; } = Array.Empty<DocumentChunk>();
}

/// <summary>C# representation of rag::DocumentChunk.</summary>
public sealed class DocumentChunk
{
    public int Index { get; init; }
    public string Text { get; init; } = string.Empty;
    public string EmbeddingText { get; init; } = string.Empty;
    public IReadOnlyList<string> HeadingPath { get; init; } = Array.Empty<string>();
    public int StartPageNumber { get; init; }
    public int StartLineNumber { get; init; }
    public int EndPageNumber { get; init; }
    public int EndLineNumber { get; init; }
}

/// <summary>A chunk enriched with its dense BGE-M3 vector.</summary>
public sealed class EmbeddedChunk
{
    public int Index { get; init; }
    public string Text { get; init; } = string.Empty;
    public string EmbeddingText { get; init; } = string.Empty;
    public IReadOnlyList<string> HeadingPath { get; init; } = Array.Empty<string>();
    public int StartPageNumber { get; init; }
    public int StartLineNumber { get; init; }
    public int EndPageNumber { get; init; }
    public int EndLineNumber { get; init; }
    public float[] Embedding { get; init; } = Array.Empty<float>();
}

/// <summary>Result returned by the embedding operation.</summary>
public sealed class EmbeddingResult
{
    public bool IsSuccessful { get; init; }
    public string Error { get; init; } = string.Empty;
    public IReadOnlyList<EmbeddedChunk> Chunks { get; init; } = Array.Empty<EmbeddedChunk>();
}

/// <summary>Paths and runtime settings for the local BGE-M3 ONNX model.</summary>
public sealed class EmbeddingServiceOptions
{
    public required string ModelPath { get; init; }
    public required string ModelWeightsPath { get; init; }
    public required string TokenizerJsonPath { get; init; }
    public int MaxSequenceLength { get; init; } = 1024;
    public int BatchSize { get; init; } = 8;
    public int IntraOpNumThreads { get; init; }
}

/// <summary>
/// Generates 1024-dimensional dense BGE-M3 embeddings for structure-aware
/// chunks. Model and tokenizer files are local; no network access is used.
/// </summary>
public sealed class EmbeddingService : IDisposable
{
    private const int EmbeddingDimension = 1024;
    private const uint PaddingTokenId = 1;
    private const uint BeginningTokenId = 0;
    private const uint EndTokenId = 2;
    private const string DenseOutputName = "dense";

    private readonly object _sync = new();
    private InferenceSession? _session;
    private Tokenizer? _tokenizer;
    private EmbeddingServiceOptions? _options;
    private bool _disposed;

    /// <summary>Loads the local ONNX model, external weights, and tokenizer.</summary>
    public void Initialize(EmbeddingServiceOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        ObjectDisposedException.ThrowIf(_disposed, this);

        if (_session is not null)
            throw new InvalidOperationException("EmbeddingService has already been initialized.");

        ValidateOptions(options);

        var tokenizer = new Tokenizer(options.TokenizerJsonPath);
        InferenceSession? session = null;

        try
        {
            using var sessionOptions = new SessionOptions
            {
                GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL
            };

            if (options.IntraOpNumThreads > 0)
                sessionOptions.IntraOpNumThreads = options.IntraOpNumThreads;

            session = new InferenceSession(options.ModelPath, sessionOptions);
            ValidateModelContract(session);

            _tokenizer = tokenizer;
            _session = session;
            _options = options;
        }
        catch
        {
            session?.Dispose();
            tokenizer.Dispose();
            throw;
        }
    }

    /// <summary>
    /// Counts tokens with the exact tokenizer loaded for BGE-M3, including
    /// the model's special tokens. This can be supplied to the C++ chunker's
    /// TokenCounter callback once the interop boundary is added.
    /// </summary>
    public int CountTokens(string text)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(text);

        if (_tokenizer is null)
            throw new InvalidOperationException("EmbeddingService is not initialized.");

        lock (_sync)
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            return _tokenizer.Encode(text).Length;
        }
    }

    /// <summary>
    /// Embeds every chunk's embedding_text and preserves its source metadata.
    /// Failure is all-or-nothing: no partial chunk list is returned.
    /// </summary>
    public EmbeddingResult Embed(ChunkingResult chunkingResult)
    {
        if (chunkingResult is null)
            return Failure("Chunking result cannot be null.");

        if (!chunkingResult.IsSuccessful)
            return Failure(string.IsNullOrWhiteSpace(chunkingResult.Error)
                ? "Cannot embed an unsuccessful chunking result."
                : $"Chunking failed: {chunkingResult.Error}");

        if (_session is null || _tokenizer is null || _options is null)
            return Failure("EmbeddingService is not initialized.");

        if (chunkingResult.Chunks.Count == 0)
            return new EmbeddingResult { IsSuccessful = true };

        lock (_sync)
        {
            try
            {
                var embeddedChunks = new List<EmbeddedChunk>(chunkingResult.Chunks.Count);

                for (var offset = 0; offset < chunkingResult.Chunks.Count; offset += _options.BatchSize)
                {
                    var count = Math.Min(_options.BatchSize, chunkingResult.Chunks.Count - offset);
                    var batch = chunkingResult.Chunks.Skip(offset).Take(count).ToArray();
                    var vectors = EmbedBatch(batch);

                    for (var i = 0; i < batch.Length; i++)
                    {
                        var source = batch[i];
                        embeddedChunks.Add(new EmbeddedChunk
                        {
                            Index = source.Index,
                            Text = source.Text,
                            EmbeddingText = source.EmbeddingText,
                            HeadingPath = source.HeadingPath.ToArray(),
                            StartPageNumber = source.StartPageNumber,
                            StartLineNumber = source.StartLineNumber,
                            EndPageNumber = source.EndPageNumber,
                            EndLineNumber = source.EndLineNumber,
                            Embedding = vectors[i]
                        });
                    }
                }

                return new EmbeddingResult { IsSuccessful = true, Chunks = embeddedChunks };
            }
            catch (Exception exception)
            {
                return Failure($"Embedding failed: {exception.Message}");
            }
        }
    }

    private float[][] EmbedBatch(IReadOnlyList<DocumentChunk> chunks)
    {
        var session = _session!;
        var tokenizer = _tokenizer!;
        var options = _options!;
        var tokenized = new uint[chunks.Count][];
        var sequenceLength = 0;

        for (var row = 0; row < chunks.Count; row++)
        {
            var text = chunks[row].EmbeddingText;
            if (string.IsNullOrWhiteSpace(text))
                throw new InvalidOperationException($"Chunk {chunks[row].Index} has empty embedding_text.");

            // The Hugging Face tokenizer.json post-processor adds <s> and </s>.
            var ids = tokenizer.Encode(text);

            if (ids.Length < 2 || ids[0] != BeginningTokenId || ids[^1] != EndTokenId)
                throw new InvalidOperationException(
                    "tokenizer.json did not add the expected XLM-RoBERTa special tokens.");

            if (ids.Length > options.MaxSequenceLength)
                throw new InvalidOperationException(
                    $"Chunk {chunks[row].Index} contains {ids.Length} tokens; limit is " +
                    $"{options.MaxSequenceLength}. Content is not silently truncated.");

            tokenized[row] = ids;
            sequenceLength = Math.Max(sequenceLength, ids.Length);
        }

        var inputIds = new DenseTensor<long>(new[] { chunks.Count, sequenceLength });
        var attentionMask = new DenseTensor<long>(new[] { chunks.Count, sequenceLength });

        for (var row = 0; row < chunks.Count; row++)
        {
            var ids = tokenized[row];
            for (var column = 0; column < sequenceLength; column++)
            {
                if (column < ids.Length)
                {
                    inputIds[row, column] = ids[column];
                    attentionMask[row, column] = 1;
                }
                else
                {
                    inputIds[row, column] = PaddingTokenId;
                    attentionMask[row, column] = 0;
                }
            }
        }

        var inputs = new[]
        {
            NamedOnnxValue.CreateFromTensor("input_ids", inputIds),
            NamedOnnxValue.CreateFromTensor("attention_mask", attentionMask)
        };

        using var outputs = session.Run(inputs);
        var denseOutput = outputs.FirstOrDefault(output => output.Name == DenseOutputName)
            ?? throw new InvalidOperationException($"ONNX model did not return '{DenseOutputName}'.");

        var denseTensor = denseOutput.AsTensor<float>();
        if (denseTensor.Rank != 2 ||
            denseTensor.Dimensions[0] != chunks.Count ||
            denseTensor.Dimensions[1] != EmbeddingDimension)
        {
            throw new InvalidOperationException(
                $"Unexpected dense output shape. Expected [{chunks.Count}, {EmbeddingDimension}].");
        }

        var flatValues = denseTensor.ToArray();
        var vectors = new float[chunks.Count][];

        for (var row = 0; row < chunks.Count; row++)
        {
            var vector = new float[EmbeddingDimension];
            Array.Copy(flatValues, row * EmbeddingDimension, vector, 0, EmbeddingDimension);
            NormalizeAndValidate(vector, chunks[row].Index);
            vectors[row] = vector;
        }

        return vectors;
    }

    private static void NormalizeAndValidate(float[] vector, int chunkIndex)
    {
        double squaredNorm = 0;
        foreach (var value in vector)
        {
            if (!float.IsFinite(value))
                throw new InvalidOperationException(
                    $"Chunk {chunkIndex} produced a non-finite embedding value.");
            squaredNorm += (double)value * value;
        }

        var norm = Math.Sqrt(squaredNorm);
        if (norm <= 0 || double.IsNaN(norm) || double.IsInfinity(norm))
            throw new InvalidOperationException(
                $"Chunk {chunkIndex} produced an invalid zero-length embedding.");

        // The selected export normalizes dense vectors; this removes numerical drift.
        for (var i = 0; i < vector.Length; i++)
            vector[i] = (float)(vector[i] / norm);
    }

    private static void ValidateOptions(EmbeddingServiceOptions options)
    {
        if (string.IsNullOrWhiteSpace(options.ModelPath) || !File.Exists(options.ModelPath))
            throw new FileNotFoundException("BGE-M3 ONNX model file was not found.", options.ModelPath);

        if (string.IsNullOrWhiteSpace(options.ModelWeightsPath) || !File.Exists(options.ModelWeightsPath))
            throw new FileNotFoundException(
                "BGE-M3 ONNX external weights file was not found.", options.ModelWeightsPath);

        if (string.IsNullOrWhiteSpace(options.TokenizerJsonPath) || !File.Exists(options.TokenizerJsonPath))
            throw new FileNotFoundException(
                "BGE-M3 tokenizer.json was not found.", options.TokenizerJsonPath);

        if (options.MaxSequenceLength is < 2 or > 1024)
            throw new ArgumentOutOfRangeException(
                nameof(options.MaxSequenceLength),
                "The selected ONNX export supports a sequence limit from 2 to 1024.");

        if (options.BatchSize < 1)
            throw new ArgumentOutOfRangeException(nameof(options.BatchSize), "BatchSize must be at least 1.");

        if (options.IntraOpNumThreads < 0)
            throw new ArgumentOutOfRangeException(
                nameof(options.IntraOpNumThreads), "IntraOpNumThreads cannot be negative.");
    }

    private static void ValidateModelContract(InferenceSession session)
    {
        foreach (var input in new[] { "input_ids", "attention_mask" })
        {
            if (!session.InputMetadata.ContainsKey(input))
                throw new InvalidOperationException($"BGE-M3 model is missing input '{input}'.");
        }

        if (!session.OutputMetadata.ContainsKey(DenseOutputName))
            throw new InvalidOperationException($"BGE-M3 model is missing output '{DenseOutputName}'.");
    }

    private static EmbeddingResult Failure(string error) =>
        new() { IsSuccessful = false, Error = error };

    public void Dispose()
    {
        if (_disposed)
            return;

        lock (_sync)
        {
            _session?.Dispose();
            _tokenizer?.Dispose();
            _session = null;
            _tokenizer = null;
            _options = null;
            _disposed = true;
        }

        GC.SuppressFinalize(this);
    }
}
