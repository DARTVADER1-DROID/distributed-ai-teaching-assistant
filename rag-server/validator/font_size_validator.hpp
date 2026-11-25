#pragma once

#include "config/validator_config.hpp"
#include "extracted_pdf_data.hpp"
#include "validation_result.hpp"

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
