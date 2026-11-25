#pragma once

#include "config/validator_config.hpp"
#include "pdf_font_size_extractor.hpp"

namespace rag {

class FontSizeValidator {
public:
    explicit FontSizeValidator(ValidatorConfig config = {});

    ValidationReport validate(const ExtractedPdfData& extracted_data) const;

private:
    ValidatorConfig config_;
    ValidationReport validateConfiguration() const;
};

} // namespace rag
