#include "validator_service.hpp"
#include "extractor_service.hpp"

#include <cstdint>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>
#include <vector>

namespace {

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
              << " RAG PDF VALIDATION + EXTRACTION TEST\n"
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

    std::cout << "[1/2] VALIDATION\n"
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

        std::cout << "\nExtraction was not started because validation failed.\n";
        return 1;
    }

    std::cout << "RESULT: PASSED\n"
              << "No validation rule violations were reported.\n\n";

    std::cout << "[2/2] HIERARCHICAL EXTRACTION\n"
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

    std::cout << "\n========================================\n"
              << " PIPELINE COMPLETED SUCCESSFULLY\n"
              << "========================================\n";
    return 0;
}
