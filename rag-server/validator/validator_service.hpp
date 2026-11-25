#pragma once

#include "config/validator_config.hpp"

#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace rag {

struct ValidationResult {
    bool is_valid;
    std::string reason;
};

class ValidatorService {
public:
    explicit ValidatorService(ValidatorConfig config = {});

    static const std::map<int, double>& defaultHeadingFontSizes();

    ValidationResult hasConsistentHeadingFontSizes(
        const std::map<int, double>& heading_font_sizes
    ) const;

    ValidationResult validatePdf(
        const std::vector<std::uint8_t>& pdf_data
    ) const;

    ValidationResult validatePdfFile(
        const std::string& pdf_file_path
    ) const;

private:
    ValidatorConfig config_;

    ValidationResult validateConfiguration() const;
    ValidationResult extractAndValidateHeadingFontSizes(
        const std::vector<std::uint8_t>& pdf_data
    ) const;
};

} // namespace rag
