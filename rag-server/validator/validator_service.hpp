#pragma once

#include "config/validator_config.hpp"
#include "font_size_validator.hpp"
#include "heading_level_validator.hpp"
#include "validation_result.hpp"
#include "extracted_pdf_data.hpp"

#include <cstdint>
#include <string>
#include <vector>

namespace rag {

class ValidatorService {
public:
    explicit ValidatorService(ValidatorConfig config = {});

    ValidationReport validatePdf(
        const std::vector<std::uint8_t>& pdf_data
    ) const;

    ValidationReport validatePdfFile(
        const std::string& pdf_file_path
    ) const;

private:
    static ValidationResult extractPdfData(
        const std::vector<std::uint8_t>& pdf_data,
        ExtractedPdfData& extracted_data,
        int precision_decimal_places
    );

    ValidatorConfig config_;
    FontSizeValidator font_size_validator_;
    HeadingLevelValidator heading_level_validator_;
};

} // namespace rag
