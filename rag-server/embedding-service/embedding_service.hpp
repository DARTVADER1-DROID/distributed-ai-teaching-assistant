#pragma once

#include <cstddef>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

namespace rag {

// Paths are supplied by the application; no model or dependency is downloaded
// by the service at runtime.
struct EmbeddingConfig {
    std::filesystem::path model_path;
    std::filesystem::path tokenizer_path;

    // BGE-M3 supports sequences up to 8192 tokens. Keep this configurable so
    // the application can enforce a smaller operational limit if required.
    std::size_t max_sequence_length = 8192;

    // Zero lets ONNX Runtime choose its default CPU thread count.
    int intra_op_threads = 0;
};

struct EmbeddingOperationResult {
    bool is_successful = false;
    std::string error;
};

struct EmbeddingResult {
    bool is_successful = false;
    std::string error;

    // L2-normalized BGE-M3 dense embedding (1024 dimensions).
    std::vector<float> dense_vector;
};

class EmbeddingService {
public:
    explicit EmbeddingService(EmbeddingConfig config);
    ~EmbeddingService();

    EmbeddingService(const EmbeddingService&) = delete;
    EmbeddingService& operator=(const EmbeddingService&) = delete;
    EmbeddingService(EmbeddingService&&) noexcept;
    EmbeddingService& operator=(EmbeddingService&&) noexcept;

    // Loads the local tokenizer and ONNX model. This performs no network access.
    EmbeddingOperationResult initialize();

    // Creates one dense embedding from the exact text supplied by the caller.
    // For document ingestion, pass DocumentChunk::embedding_text.
    EmbeddingResult embedText(const std::string& text) const;

    // Uses the same BGE-M3 tokenizer as inference. Special tokens are included,
    // making this suitable for ChunkerService's TokenCounter callback.
    std::size_t countTokens(const std::string& text) const;

    bool isInitialized() const noexcept;

private:
    class Implementation;
    std::unique_ptr<Implementation> implementation_;
};

} // namespace rag
