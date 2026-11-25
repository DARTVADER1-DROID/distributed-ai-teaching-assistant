#pragma once

#include "config/validator_config.hpp"
#include "pdf_font_size_extractor.hpp"

namespace rag {

class HeadingLevelValidator {
public:
    explicit HeadingLevelValidator(ValidatorConfig config = {});

    ValidationReport validate(const ExtractedPdfData& extracted_data) const;

private:
    ValidatorConfig config_;
};

} // namespace rag
