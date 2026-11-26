using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.Json;
using RagServer.EmbeddingService;

internal static class Program
{
    private static int Main(string[] args)
    {
        Console.OutputEncoding = new UTF8Encoding(false);

        if (args.Length is < 1 or > 2)
        {
            Console.WriteLine("RAG PDF -> BGE-M3 embedding test");
            Console.WriteLine("Usage:");
            Console.WriteLine("  rag_pipeline_test.exe <path-to-pdf> [model-directory]");
            Console.WriteLine();
            Console.WriteLine("Default model directory: .\\models\\bge-m3");
            return 2;
        }

        var pdfPath = Path.GetFullPath(args[0]);
        if (!File.Exists(pdfPath))
        {
            Console.Error.WriteLine($"PDF not found: {pdfPath}");
            return 2;
        }

        var baseDirectory = AppContext.BaseDirectory;
        var nativePath = Path.Combine(baseDirectory, "rag_pipeline_native.exe");
        if (!File.Exists(nativePath))
        {
            Console.Error.WriteLine($"Native C++ pipeline executable not found: {nativePath}");
            return 2;
        }

        var modelDirectory = Path.GetFullPath(
            args.Length == 2 ? args[1] : Path.Combine(baseDirectory, "models", "bge-m3"));

        var options = new EmbeddingServiceOptions
        {
            ModelPath = Path.Combine(modelDirectory, "model_fp32.onnx"),
            ModelWeightsPath = Path.Combine(modelDirectory, "model_fp32.onnx.data"),
            TokenizerJsonPath = Path.Combine(modelDirectory, "tokenizer_hf", "tokenizer.json"),
            BatchSize = 8,
            MaxSequenceLength = 1024
        };

        using var embeddingService = new EmbeddingService();
        var modelTimer = Stopwatch.StartNew();

        try
        {
            Console.WriteLine("========================================");
            Console.WriteLine(" RAG PDF + BGE-M3 EMBEDDING TEST");
            Console.WriteLine("========================================");
            Console.WriteLine($"PDF: {pdfPath}");
            Console.WriteLine($"Model: {modelDirectory}");
            Console.WriteLine();
            Console.WriteLine("[0/4] Loading local BGE-M3 model and tokenizer...");
            embeddingService.Initialize(options);
            modelTimer.Stop();
            Console.WriteLine($"Model initialized in {modelTimer.Elapsed.TotalSeconds:F2} s");
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"MODEL INITIALIZATION FAILED: {exception.Message}");
            return 1;
        }

        var chunks = new List<DocumentChunk>();
        var nativeTimer = Stopwatch.StartNew();
        var protocolCompleted = false;

        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = nativePath,
                WorkingDirectory = baseDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardInputEncoding = Encoding.UTF8,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            }
        };
        process.StartInfo.ArgumentList.Add(pdfPath);

        try
        {
            if (!process.Start())
                throw new InvalidOperationException("Could not start the native C++ pipeline.");

            var nativeLogTask = process.StandardError.ReadToEndAsync();

            string? line;
            while ((line = process.StandardOutput.ReadLine()) is not null)
            {
                if (line.StartsWith("TOKENIZE\t", StringComparison.Ordinal))
                {
                    var encodedText = line[9..];
                    var text = Encoding.UTF8.GetString(Convert.FromBase64String(encodedText));
                    var tokenCount = embeddingService.CountTokens(text);
                    awaitWriteResponse(process, tokenCount);
                }
                else if (line.StartsWith("CHUNK\t", StringComparison.Ordinal))
                {
                    chunks.Add(ParseChunk(line));
                }
                else if (line == "DONE")
                {
                    protocolCompleted = true;
                    break;
                }
                else
                {
                    throw new InvalidDataException("Unknown native pipeline protocol message.");
                }
            }

            if (!protocolCompleted)
                throw new InvalidOperationException("Native pipeline ended before chunk transfer completed.");

            process.StandardInput.Close();
            process.WaitForExit();
            var nativeLog = nativeLogTask.GetAwaiter().GetResult();
            if (!string.IsNullOrWhiteSpace(nativeLog))
                Console.Write(nativeLog);

            if (process.ExitCode != 0)
                throw new InvalidOperationException($"Native C++ pipeline failed with exit code {process.ExitCode}.");

            nativeTimer.Stop();
        }
        catch (Exception exception)
        {
            try
            {
                if (!process.HasExited)
                    process.Kill(entireProcessTree: true);
            }
            catch
            {
                // Preserve the original integration error.
            }

            Console.Error.WriteLine($"NATIVE PIPELINE FAILED: {exception.Message}");
            return 1;
        }

        Console.WriteLine($"C++ stages completed; received {chunks.Count} chunks.");
        Console.WriteLine("BGE-M3 tokenizer was used by the C++ chunker for all chunk-size decisions.");
        Console.WriteLine();

        var embeddingTimer = Stopwatch.StartNew();
        var embeddingResult = embeddingService.Embed(new ChunkingResult
        {
            IsSuccessful = true,
            Chunks = chunks
        });
        embeddingTimer.Stop();

        if (!embeddingResult.IsSuccessful)
        {
            Console.Error.WriteLine($"EMBEDDING FAILED: {embeddingResult.Error}");
            return 1;
        }

        var outputPath = Path.Combine(
            Path.GetDirectoryName(pdfPath)!,
            Path.GetFileNameWithoutExtension(pdfPath) + ".embeddings.json");

        var output = new
        {
            sourcePdf = pdfPath,
            model = "BAAI/bge-m3 (FP32 ONNX, dense)",
            embeddingDimension = 1024,
            chunkCount = embeddingResult.Chunks.Count,
            timingsMilliseconds = new
            {
                modelInitialization = Math.Round(modelTimer.Elapsed.TotalMilliseconds, 3),
                cppPipelineAndTokenization = Math.Round(nativeTimer.Elapsed.TotalMilliseconds, 3),
                embedding = Math.Round(embeddingTimer.Elapsed.TotalMilliseconds, 3)
            },
            chunks = embeddingResult.Chunks
        };

        try
        {
            File.WriteAllText(
                outputPath,
                JsonSerializer.Serialize(output, new JsonSerializerOptions { WriteIndented = true }),
                new UTF8Encoding(false));
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"Could not write embedding output: {exception.Message}");
            return 1;
        }

        Console.WriteLine("========================================");
        Console.WriteLine(" EMBEDDING RESULTS");
        Console.WriteLine("========================================");
        Console.WriteLine($"Embedded chunks: {embeddingResult.Chunks.Count}");
        Console.WriteLine("Vector dimensions: 1024");
        Console.WriteLine($"Embedding time: {embeddingTimer.Elapsed.TotalSeconds:F2} s");

        foreach (var chunk in embeddingResult.Chunks.Take(5))
        {
            var norm = Math.Sqrt(chunk.Embedding.Sum(value => (double)value * value));
            var preview = string.Join(", ", chunk.Embedding.Take(6)
                .Select(value => value.ToString("F6", CultureInfo.InvariantCulture)));
            Console.WriteLine($"Chunk {chunk.Index}: dims={chunk.Embedding.Length}, L2={norm:F6}, first values=[{preview}, ...]");
        }

        Console.WriteLine();
        Console.WriteLine($"Full vectors + source metadata saved to:");
        Console.WriteLine(outputPath);
        Console.WriteLine("PIPELINE COMPLETED: PDF -> VALIDATION -> EXTRACTION -> CHUNKING -> BGE-M3 EMBEDDINGS");
        return 0;
    }

    private static void awaitWriteResponse(Process process, int tokenCount)
    {
        process.StandardInput.WriteLine($"COUNT\t{tokenCount}");
        process.StandardInput.Flush();
    }

    private static DocumentChunk ParseChunk(string line)
    {
        var fields = line.Split('\t');
        if (fields.Length < 9 || fields[0] != "CHUNK")
            throw new InvalidDataException("Malformed chunk protocol message.");

        var headingCount = int.Parse(fields[4], CultureInfo.InvariantCulture);
        if (headingCount < 0 || fields.Length != 9 + headingCount)
            throw new InvalidDataException("Chunk heading metadata length is inconsistent.");

        var headings = new string[headingCount];
        for (var i = 0; i < headingCount; i++)
            headings[i] = Decode(fields[5 + i]);

        var metadata = 5 + headingCount;
        return new DocumentChunk
        {
            Index = int.Parse(fields[1], CultureInfo.InvariantCulture),
            Text = Decode(fields[2]),
            EmbeddingText = Decode(fields[3]),
            HeadingPath = headings,
            StartPageNumber = int.Parse(fields[metadata], CultureInfo.InvariantCulture),
            StartLineNumber = int.Parse(fields[metadata + 1], CultureInfo.InvariantCulture),
            EndPageNumber = int.Parse(fields[metadata + 2], CultureInfo.InvariantCulture),
            EndLineNumber = int.Parse(fields[metadata + 3], CultureInfo.InvariantCulture)
        };
    }

    private static string Decode(string value) =>
        Encoding.UTF8.GetString(Convert.FromBase64String(value));
}
