#pragma once

#include "../config/document_format_config.hpp"

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

namespace rag {

enum class DocumentNodeType {
    Document,
    Heading,
    Paragraph
};

// A recursive node in the extracted document tree.
// Heading levels are meaningful only for Heading nodes.
struct DocumentNode {
    DocumentNodeType type = DocumentNodeType::Document;
    int heading_level = 0;
    std::string text;

    // One-based PDF page and visual line locations.
    std::size_t page_number = 0;
    std::size_t line_number = 0;
    std::size_t end_page_number = 0;
    std::size_t page_count = 0;
    std::size_t end_line_number = 0;

    std::vector<DocumentNode> children;
};

struct ExtractionResult {
    bool is_successful = false;
    std::string error;
    DocumentNode document;
};

class ExtractorService {
public:
    explicit ExtractorService(DocumentFormatConfig config = {});

    // Extracts a previously validated PDF from its raw bytes and reconstructs
    // its heading/paragraph hierarchy using the shared typography config.
    ExtractionResult extractPdf(
        const std::vector<std::uint8_t>& pdf_data
    ) const;

private:
    DocumentFormatConfig config_;
};

} // namespace rag
