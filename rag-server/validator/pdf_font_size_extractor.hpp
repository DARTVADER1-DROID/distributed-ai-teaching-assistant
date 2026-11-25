#pragma once

#include "validation_result.hpp"

#include <cstddef>
#include <cstdint>
#include <map>
#include <string>
#include <vector>

namespace rag {

struct ExtractedPdfLine {
    std::size_t page_number = 0;
    std::size_t line_number = 0;
    std::string text;
    std::size_t word_count = 0;
    std::vector<double> font_sizes;
};

struct ExtractedPdfData {
    // Lines are kept in Poppler's text-list order, grouped by visual position.
    std::vector<ExtractedPdfLine> lines;

    // Font sizes in text-box order, retained for aggregate statistics.
    std::vector<double> ordered_font_sizes;
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
