#pragma once

#include "../chunker/chunker_service.hpp"

#include <cstddef>
#include <string>
#include <vector>

namespace rag {

// Result shared by content creation, replacement and deletion operations.
struct VdbOperationResult {
    bool is_successful = false;
    std::string error;
};

// Document-level information returned by showAllContent().
struct StoredContentInfo {
    std::string pdf_name;
    std::size_t chunk_count = 0;
};

// One matching chunk returned by readContent().
struct RetrievedChunk {
    DocumentChunk chunk;
    float similarity_score = 0.0F;
};

// Result returned by semantic retrieval.
struct VdbRetrievalResult {
    bool is_successful = false;
    std::string error;
    std::vector<RetrievedChunk> results;
};

// Result returned by showAllContent().
struct VdbContentListResult {
    bool is_successful = false;
    std::string error;
    std::vector<StoredContentInfo> contents;
};

class VdbManagerService {
public:
    // Creates one complete PDF content. pdf_name is its unique identity.
    VdbOperationResult createContent(
        const std::string& pdf_name,
        const std::vector<DocumentChunk>& chunks,
        const std::vector<std::vector<float>>& embeddings
    );

    // Replaces the complete content associated with an existing PDF name.
    VdbOperationResult updateContent(
        const std::string& pdf_name,
        const std::vector<DocumentChunk>& chunks,
        const std::vector<std::vector<float>>& embeddings
    );

    // Retrieves the most relevant chunks for a query embedding.
    VdbRetrievalResult readContent(
        const std::vector<float>& query_embedding,
        std::size_t max_results
    ) const;

    // Deletes one complete PDF content and all its associated records.
    VdbOperationResult deleteContent(const std::string& pdf_name);

    // Lists all stored PDF contents and their document-level metadata.
    VdbContentListResult showAllContent() const;

    // Deletes all contents managed by this service.
    VdbOperationResult deleteAllContent();
};

} // namespace rag
