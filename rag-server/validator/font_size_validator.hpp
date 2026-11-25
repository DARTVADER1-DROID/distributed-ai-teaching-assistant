#pragma once

#include "config/validator_config.hpp"
#include "validation_result.hpp"

#include <map>

namespace rag {

class FontSizeValidator {
public:
    explicit FontSizeValidator(ValidatorConfig config = {});

    ValidationResult validateConfiguration() const;

    ValidationResult validate(
        const std::map<int, double>& heading_font_sizes
    ) const;

    static const std::map<int, double>& defaultHeadingFontSizes();

private:
    ValidatorConfig config_;
};

} // namespace rag
