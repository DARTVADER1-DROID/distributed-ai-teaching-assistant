#include "validator_service.hpp"

#include <cstdlib>
#include <iostream>
#include <string>

namespace {

void printUsage(const char* executable) {
    std::cerr << "Usage: " << executable << " <pdf-file>\n";
}

void printReport(const rag::ValidationReport& report) {
    std::cout << "Validation result: "
              << (report.isValid() ? "PASS" : "FAIL") << '\n';
    std::cout << "Configuration: "
              << (report.configuration_valid ? "valid" : "invalid") << '\n';
    std::cout << "Issues found: " << report.issues.size() << "\n\n";

    for (std::size_t index = 0; index < report.issues.size(); ++index) {
        const auto& issue = report.issues[index];

        std::cout << "Issue " << (index + 1) << '\n';
        std::cout << "  Reason: " << issue.reason << '\n';

        if (issue.page_number != 0) {
            std::cout << "  Page: " << issue.page_number << '\n';
        }
        if (issue.line_number != 0) {
            std::cout << "  Line: " << issue.line_number << '\n';
        }
        if (issue.word_count != 0) {
            std::cout << "  Word count: " << issue.word_count << '\n';
        }
        if (!issue.line_text.empty()) {
            std::cout << "  Text: " << issue.line_text << '\n';
        }

        std::cout << '\n';
    }
}

} // namespace

int main(int argc, char* argv[]) {
    if (argc != 2) {
        printUsage(argv[0]);
        return EXIT_FAILURE;
    }

    const std::string pdf_file_path = argv[1];

    // Uses the validator's default rules. Adjust ValidatorConfig here when
    // testing a document with a different formatting or page-count policy.
    const rag::ValidatorConfig config;
    const rag::ValidatorService validator(config);

    const rag::ValidationReport report =
        validator.validatePdfFile(pdf_file_path);

    printReport(report);

    return report.isValid() ? EXIT_SUCCESS : 1;
}
