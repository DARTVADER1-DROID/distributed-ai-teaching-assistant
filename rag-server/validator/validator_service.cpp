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

ValidationResult ValidatorService::validatePdf(
    const std::vector<std::uint8_t>& pdf_data
) const {
    ExtractedPdfData extracted_data;
    const auto extraction_result = PdfFontSizeExtractor::extract(
        pdf_data,
        extracted_data,
        config_.font_size_precision_decimal_places
    );

    if (!extraction_result.is_valid) {
        return extraction_result;
    }

    const auto font_result = font_size_validator_.validate(extracted_data);
    if (!font_result.is_valid) {
        return font_result;
    }

    return heading_level_validator_.validate(extracted_data);
}

ValidationResult ValidatorService::validatePdfFile(
    const std::string& pdf_file_path
) const {
    if (pdf_file_path.empty()) {
        return {false, "PDF file path must not be empty."};
    }

    std::ifstream pdf_file(pdf_file_path, std::ios::binary);
    if (!pdf_file) {
        return {false, "Unable to open PDF file: " + pdf_file_path};
    }

    std::vector<std::uint8_t> pdf_data(
        (std::istreambuf_iterator<char>(pdf_file)),
        std::istreambuf_iterator<char>()
    );

    if (pdf_file.bad()) {
        return {false, "Failed while reading PDF file: " + pdf_file_path};
    }

    return validatePdf(pdf_data);
}

} // namespace rag
