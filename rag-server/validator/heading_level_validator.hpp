#pragma once

#include "config/validator_config.hpp"
#include "extracted_pdf_data.hpp"
#include "validation_result.hpp"

namespace rag {

class HeadingLevelValidator {
public:
    explicit HeadingLevelValidator(ValidatorConfig config = {});

    ValidationReport validate(const ExtractedPdfData& extracted_data) const;

private:
    ValidatorConfig config_;
};

} // namespace rag
