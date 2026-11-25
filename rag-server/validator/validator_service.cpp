#include "validator_service.hpp"

#include "pdf_font_size_extractor.hpp"

#include <fstream>
#include <iterator>
#include <utility>

namespace rag {

ValidatorService::ValidatorService(ValidatorConfig config)
    : config_(config),
      font_size_validator_(config),
      heading_level_validator_(std::move(config)) {}

ValidationReport ValidatorService::validatePdf(
    const std::vector<std::uint8_t>& pdf_data
) const {
    ValidationReport report;
    ExtractedPdfData extracted_data;

    const auto extraction_result = PdfFontSizeExtractor::extract(
        pdf_data,
        extracted_data,
        config_.font_size_precision_decimal_places
    );

    if (!extraction_result.is_valid) {
        report.addIssue({
            extraction_result.reason,
            extraction_result.page_number
        });
        return report;
    }

    // Run both validators even when the first one finds rule violations.
    report.append(font_size_validator_.validate(extracted_data));
    report.append(heading_level_validator_.validate(extracted_data));

    return report;
}

ValidationReport ValidatorService::validatePdfFile(
    const std::string& pdf_file_path
) const {
    ValidationReport report;

    if (pdf_file_path.empty()) {
        report.addIssue({"PDF file path must not be empty."});
        return report;
    }

    std::ifstream pdf_file(pdf_file_path, std::ios::binary);
    if (!pdf_file) {
        report.addIssue({"Unable to open PDF file: " + pdf_file_path});
        return report;
    }

    std::vector<std::uint8_t> pdf_data(
        (std::istreambuf_iterator<char>(pdf_file)),
        std::istreambuf_iterator<char>()
    );

    if (pdf_file.bad()) {
        report.addIssue({"Failed while reading PDF file: " + pdf_file_path});
        return report;
    }

    return validatePdf(pdf_data);
}

} // namespace rag
