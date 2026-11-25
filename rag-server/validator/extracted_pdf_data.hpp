#pragma once

#include <cstddef>
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
    std::size_t page_count = 0;
    std::vector<ExtractedPdfLine> lines;
    std::vector<double> ordered_font_sizes;
    std::map<double, std::size_t> font_size_frequency;
    double body_font_size = 0.0;
};

} // namespace rag
