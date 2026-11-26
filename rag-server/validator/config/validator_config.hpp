#pragma once

#include "../../config/document_format_config.hpp"

#include <cstddef>

namespace rag {

// Validator-specific settings combined with the shared document typography
// rules used by both validation and extraction.
struct ValidatorConfig : public DocumentFormatConfig {
    // Minimum number of pages required in an input PDF.
    std::size_t minimum_pages = 1;

    // Maximum number of pages allowed. Zero disables the upper limit.
    std::size_t maximum_pages = 0;
};

} // namespace rag
