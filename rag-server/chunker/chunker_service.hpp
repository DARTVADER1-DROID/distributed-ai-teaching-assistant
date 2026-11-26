#pragma once

#include "../extractor/extractor_service.hpp"

#include <cstddef>
#include <string>
#include <vector>

namespace rag {

// One retrieval-ready text unit produced from the extracted document tree.
struct DocumentChunk {
    std::size_t index = 0;
    std::string text;

    // Heading titles from the document root to the section containing this chunk.
    std::vector<std::string> heading_path;

    // One-based source PDF page range.
    std::size_t start_page_number = 0;
    std::size_t end_page_number = 0;
};

struct ChunkingResult {
    bool is_successful = false;
    std::string error;
    std::vector<DocumentChunk> chunks;
};

class ChunkerService {
public:
    ChunkerService() = default;

    // Converts a hierarchical document tree into ordered retrieval-ready chunks.
    // Chunking rules and implementation will be added after their design is approved.
    ChunkingResult chunkDocument(const DocumentNode& document) const;
};

} // namespace rag
