#include "vdb_manager_service.hpp"

namespace rag {

VdbOperationResult VdbManagerService::createContent(
    const std::string& pdf_name,
    const std::vector<DocumentChunk>& chunks,
    const std::vector<std::vector<float>>& embeddings
) {
    return {};
}

VdbOperationResult VdbManagerService::updateContent(
    const std::string& pdf_name,
    const std::vector<DocumentChunk>& chunks,
    const std::vector<std::vector<float>>& embeddings
) {
    return {};
}

VdbRetrievalResult VdbManagerService::readContent(
    const std::vector<float>& query_embedding,
    std::size_t max_results
) const {
    return {};
}

VdbOperationResult VdbManagerService::deleteContent(
    const std::string& pdf_name
) {
    return {};
}

VdbContentListResult VdbManagerService::showAllContent() const {
    return {};
}

VdbOperationResult VdbManagerService::deleteAllContent() {
    return {};
}

} // namespace rag
