#pragma once

#include "config/validator_config.hpp"
#include "pdf_font_size_extractor.hpp"

namespace rag {

class FontSizeValidator {
public:
    explicit FontSizeValidator(ValidatorConfig config = {});

    ValidationResult validate(const ExtractedPdfData& extracted_data) const;

private:
    ValidatorConfig config_;
    ValidationResult validateConfiguration() const;
};

} // namespace rag
