#include "validator_service.hpp"
#include "extractor_service.hpp"
#include "chunker_service.hpp"

#include <cctype>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
#include <vector>

namespace {

// Temporary test-only tokenizer. It counts whitespace-separated tokens.
// This is deliberately NOT presented as the BGE-M3 tokenizer.
std::size_t countTestTokens(const std::string& text) {
    std::size_t count = 0;
    bool inside_token = false;

    for (const unsigned char character : text) {
        if (std::isspace(character)) {
            inside_token = false;
        } else if (!inside_token) {
            ++count;
            inside_token = true;
        }
    }

    return count;
}

void printTree(const rag::DocumentNode& node, std::size_t depth = 0) {
    const std::string indent(depth * 2, ' ');

    if (node.type == rag::DocumentNodeType::Document) {
        std::cout << indent << "Document (" << node.page_count << " pages)\n";
    } else if (node.type == rag::DocumentNodeType::Heading) {
        std::cout << indent << "H" << node.heading_level << ": "
                  << node.text << " [page " << node.page_number
                  << ", line " << node.line_number << "]\n";
    } else {
        std::cout << indent << "Paragraph: " << node.text
                  << " [page " << node.page_number << ", lines "
                  << node.line_number << "-" << node.end_line_number
                  << "]\n";
    }

    for (const auto& child : node.children) {
        printTree(child, depth + 1);
    }
}

bool readPdf(const std::string& path, std::vector<std::uint8_t>& bytes) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        std::cerr << "ERROR: Cannot open PDF: " << path << '\n';
        return false;
    }

    bytes.assign(
        std::istreambuf_iterator<char>(input),
        std::istreambuf_iterator<char>()
    );

    if (input.bad()) {
        std::cerr << "ERROR: Failed while reading PDF: " << path << '\n';
        return false;
    }
    if (bytes.empty()) {
        std::cerr << "ERROR: The selected PDF is empty.\n";
        return false;
    }
    return true;
}

void printHeadingPath(const std::vector<std::string>& heading_path) {
    if (heading_path.empty()) {
        std::cout << "(document root)";
        return;
    }

    for (std::size_t i = 0; i < heading_path.size(); ++i) {
        if (i != 0) {
            std::cout << " > ";
        }
        std::cout << heading_path[i];
    }
}

} // namespace

int main(int argc, char* argv[]) {
    if (argc != 2) {
        std::cerr << "Usage:\n"
                  << "  rag_pipeline_test.exe <path-to-pdf>\n\n"
                  << "Example:\n"
                  << "  rag_pipeline_test.exe \"C:\\Users\\You\\Documents\\sample.pdf\"\n";
        return 2;
    }

    const std::string pdf_path = argv[1];
    std::vector<std::uint8_t> pdf_bytes;

    std::cout << "========================================\n"
              << " RAG PDF VALIDATION + EXTRACTION + CHUNKING TEST\n"
              << "========================================\n"
              << "Input: " << pdf_path << "\n\n";

    if (!readPdf(pdf_path, pdf_bytes)) {
        return 2;
    }

    // Keep typography rules identical across validation and extraction.
    rag::DocumentFormatConfig format_config;
    rag::ValidatorConfig validator_config;
    static_cast<rag::DocumentFormatConfig&>(validator_config) = format_config;

    const rag::ValidatorService validator(validator_config);

    std::cout << "[1/3] VALIDATION\n"
              << "----------------------------------------\n";

    const rag::ValidationReport validation =
        validator.validatePdf(pdf_bytes);

    if (!validation.isValid()) {
        std::cout << "RESULT: FAILED (" << validation.issues.size()
                  << " issue(s))\n\n";

        for (std::size_t i = 0; i < validation.issues.size(); ++i) {
            const auto& issue = validation.issues[i];
            std::cout << (i + 1) << ". " << issue.reason << '\n';

            if (issue.page_number > 0) {
                std::cout << "   Page: " << issue.page_number << '\n';
            }
            if (issue.line_number > 0) {
                std::cout << "   Line: " << issue.line_number << '\n';
            }
            if (issue.word_count > 0) {
                std::cout << "   Word count: " << issue.word_count << '\n';
            }
            if (!issue.line_text.empty()) {
                std::cout << "   Text: " << issue.line_text << '\n';
            }
        }

        std::cout << "\nExtraction and chunking were not started because "
                     "validation failed.\n";
        return 1;
    }

    std::cout << "RESULT: PASSED\n"
              << "No validation rule violations were reported.\n\n";

    std::cout << "[2/3] HIERARCHICAL EXTRACTION\n"
              << "----------------------------------------\n";

    const rag::ExtractorService extractor(format_config);
    const rag::ExtractionResult extraction =
        extractor.extractPdf(pdf_bytes);

    if (!extraction.is_successful) {
        std::cout << "RESULT: FAILED\n"
                  << "Reason: " << extraction.error << '\n';
        return 1;
    }

    std::cout << "RESULT: PASSED\n\n"
              << "Extracted document tree:\n";
    printTree(extraction.document);

    std::cout << "\n[3/3] STRUCTURE-AWARE CHUNKING\n"
              << "----------------------------------------\n";

    // The configured limit comes from rag-server/config/chunker_config.hpp.
    rag::ChunkerConfig chunker_config;
    const rag::TokenCounter test_tokenizer = countTestTokens;

    std::cout << "Configured maximum: " << chunker_config.max_chunk_tokens
              << " test tokens\n"
              << "Tokenizer: TEST ONLY (whitespace-separated tokens)\n"
              << "Note: counts are not BGE-M3 token counts.\n\n";

    const rag::ChunkerService chunker(chunker_config, test_tokenizer);
    const rag::ChunkingResult chunking = chunker.chunkDocument(extraction);

    if (!chunking.is_successful) {
        std::cout << "RESULT: FAILED\n"
                  << "Reason: " << chunking.error << '\n';
        return 1;
    }

    std::cout << "RESULT: PASSED\n"
              << "Generated chunks: " << chunking.chunks.size() << "\n\n";

    bool token_limit_ok = true;
    for (const auto& chunk : chunking.chunks) {
        const std::size_t token_count =
            test_tokenizer(chunk.embedding_text);
        if (token_count > chunker_config.max_chunk_tokens) {
            token_limit_ok = false;
        }

        std::cout << "========================================\n"
                  << "CHUNK " << chunk.index << '\n'
                  << "========================================\n"
                  << "Heading path: ";
        printHeadingPath(chunk.heading_path);

        std::cout << "\nTest token count: " << token_count
                  << " / " << chunker_config.max_chunk_tokens
                  << (token_count <= chunker_config.max_chunk_tokens
                          ? " [OK]\n"
                          : " [LIMIT EXCEEDED]\n")
                  << "Source pages: " << chunk.start_page_number
                  << "-" << chunk.end_page_number << '\n'
                  << "Source lines: " << chunk.start_line_number
                  << "-" << chunk.end_line_number << "\n\n"
                  << "Original chunk text:\n"
                  << chunk.text << "\n\n"
                  << "Embedding input (heading context + text):\n"
                  << chunk.embedding_text << "\n\n";
    }

    if (!token_limit_ok) {
        std::cout << "CHUNKING CHECK: FAILED - a chunk exceeded the "
                     "configured test-token limit.\n";
        return 1;
    }

    std::cout << "CHUNKING CHECK: PASSED - all chunks are within the "
                 "configured test-token limit.\n";

    std::cout << "\n========================================\n"
              << " PIPELINE COMPLETED SUCCESSFULLY\n"
              << "========================================\n";
    return 0;
}
