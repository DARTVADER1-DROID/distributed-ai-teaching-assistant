#pragma once

#include "validation_result.hpp"

#include <cstddef>
#include <cstdint>
#include <map>
#include <vector>

namespace rag {

struct ExtractedPdfData {
    // Font sizes in Poppler's document/text-box order.
    std::vector<double> ordered_font_sizes;

    // Frequency of each normalized font size across the document.
    std::map<double, std::size_t> font_size_frequency;

    // Most frequently occurring font size, used as the body-text baseline.
    double body_font_size = 0.0;
};

class PdfFontSizeExtractor {
public:
    static ValidationResult extract(
        const std::vector<std::uint8_t>& pdf_data,
        ExtractedPdfData& extracted_data,
        int precision_decimal_places
    );
};

} // namespace rag
