#pragma once

#include "../config/chunker_config.hpp"
#include "../extractor/extractor_service.hpp"

#include <cstddef>
#include <functional>
#include <string>
#include <vector>

namespace rag {

// Counts tokens using the tokenizer that will be used by the embedding model.
// The callback must return the exact token count for the supplied UTF-8 text.
using TokenCounter = std::function<std::size_t(const std::string&)>;

// One retrieval-ready text unit produced from the extracted document tree.
struct DocumentChunk {
    // Zero-based position in the document's ordered chunk collection.
    std::size_t index = 0;

    // Original extracted content, without synthetic heading prefixes.
    std::string text;

    // Text to send to the embedding model: heading context plus original text.
    std::string embedding_text;

    // Heading titles from the document root to the section containing this chunk.
    std::vector<std::string> heading_path;

    // Source start and end positions. Each line number belongs to its paired page.
    // All page and line numbers are one-based PDF positions.
    std::size_t start_page_number = 0;
    std::size_t start_line_number = 0;
    std::size_t end_page_number = 0;
    std::size_t end_line_number = 0;
};

struct ChunkingResult {
    bool is_successful = false;
    std::string error;
    std::vector<DocumentChunk> chunks;
};

class ChunkerService {
public:
    ChunkerService(
        ChunkerConfig config,
        TokenCounter token_counter
    );

    // Converts a successful extractor result into ordered embedding-ready chunks.
    ChunkingResult chunkDocument(const ExtractionResult& extraction) const;

private:
    ChunkerConfig config_;
    TokenCounter token_counter_;
};

} // namespace rag
