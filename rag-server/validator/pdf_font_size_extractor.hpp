#pragma once

#include "validation_result.hpp"

#include <cstdint>
#include <vector>

namespace rag {

class PdfFontSizeExtractor {
public:
    // Extracts font sizes in Poppler's text-box order.
    static ValidationResult extract(
        const std::vector<std::uint8_t>& pdf_data,
        std::vector<double>& font_sizes
    );
};

} // namespace rag
