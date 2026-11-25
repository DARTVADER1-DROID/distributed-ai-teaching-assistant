#pragma once

#include "config/validator_config.hpp"
#include "font_size_validator.hpp"
#include "heading_level_validator.hpp"
#include "validation_result.hpp"

#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace rag {

class ValidatorService {
public:
    explicit ValidatorService(ValidatorConfig config = {});

    static const std::map<int, double>& defaultHeadingFontSizes();

    // Compatibility-facing delegates; implementations live in dedicated validators.
    ValidationResult hasConsistentHeadingFontSizes(
        const std::map<int, double>& heading_font_sizes
    ) const;

    ValidationResult hasValidHeadingLevelTraversal(
        const std::vector<int>& heading_levels
    ) const;

    ValidationResult validatePdf(
        const std::vector<std::uint8_t>& pdf_data
    ) const;

    ValidationResult validatePdfFile(
        const std::string& pdf_file_path
    ) const;

private:
    ValidatorConfig config_;
    FontSizeValidator font_size_validator_;
    HeadingLevelValidator heading_level_validator_;

    ValidationResult extractAndValidateHeadingFontSizes(
        const std::vector<std::uint8_t>& pdf_data
    ) const;
};

} // namespace rag
