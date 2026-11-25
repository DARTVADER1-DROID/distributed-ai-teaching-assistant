#include "pdf_font_size_extractor.hpp"

#include <poppler/cpp/poppler-document.h>
#include <poppler/cpp/poppler-page.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <memory>
#include <sstream>
#include <string>
#include <utility>

namespace rag {
namespace {

std::size_t countWords(const std::string& text) {
    std::istringstream input(text);
    std::size_t count = 0;
    std::string word;
    while (input >> word) {
        ++count;
    }
    return count;
}

double verticalCenter(const poppler::rectf& bounds) {
    return bounds.top() + bounds.height() / 2.0;
}

bool belongsToLine(
    const poppler::rectf& bounds,
    double line_center,
    double line_height
) {
    (void)line;
    const double center = verticalCenter(bounds);
    const double tolerance = std::max(2.0, std::min(bounds.height(), line_height) * 0.5);
    return std::fabs(center - line_center) <= tolerance;
}

} // namespace

ValidationResult PdfFontSizeExtractor::extract(
    const std::vector<std::uint8_t>& pdf_data,
    ExtractedPdfData& extracted_data,
    int precision_decimal_places
) {
    extracted_data = {};

    if (precision_decimal_places < 0 || precision_decimal_places > 6) {
        return {false, "Font-size precision must be between 0 and 6 decimal places."};
    }
    if (pdf_data.empty()) {
        return {false, "PDF data is empty."};
    }
    if (pdf_data.size() >
        static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        return {false, "PDF data is too large to parse."};
    }

    const auto* raw_data = reinterpret_cast<const char*>(pdf_data.data());
    std::unique_ptr<poppler::document> document(
        poppler::document::load_from_raw_data(
            raw_data,
            static_cast<int>(pdf_data.size())
        )
    );

    if (!document) {
        return {false, "Unable to parse input as a valid PDF document."};
    }
    if (document->is_locked()) {
        return {false, "PDF is encrypted or password-protected."};
    }
    if (document->pages() <= 0) {
        return {false, "PDF contains no pages."};
    }

    const double precision_scale = std::pow(10.0, precision_decimal_places);

    for (int page_index = 0; page_index < document->pages(); ++page_index) {
        std::unique_ptr<poppler::page> page(document->create_page(page_index));
        if (!page) {
            return {
                false,
                "Failed to read PDF page " + std::to_string(page_index + 1) + ".",
                static_cast<std::size_t>(page_index + 1)
            };
        }

        const auto text_boxes =
            page->text_list(poppler::page::text_list_include_font);

        std::size_t page_line_number = 0;
        double current_line_center = 0.0;
        double current_line_height = 0.0;

        for (const auto& text_box : text_boxes) {
            const std::string word = text_box.text().to_utf8();
            if (word.empty()) {
                continue;
            }

            const poppler::rectf bounds = text_box.bbox();
            const double center = verticalCenter(bounds);
            const double height = std::max(1.0, bounds.height());

            if (extracted_data.lines.empty() ||
                extracted_data.lines.back().page_number !=
                    static_cast<std::size_t>(page_index + 1) ||
                !belongsToLine(
                    bounds,
                    current_line_center,
                    current_line_height
                )) {
                ++page_line_number;
                ExtractedPdfLine line;
                line.page_number = static_cast<std::size_t>(page_index + 1);
                line.line_number = page_line_number;
                extracted_data.lines.push_back(std::move(line));
                current_line_center = center;
                current_line_height = height;
            } else {
                // Keep the line center stable while allowing small baseline drift.
                current_line_center =
                    (current_line_center * static_cast<double>(
                        extracted_data.lines.back().word_count
                    ) + center) /
                    static_cast<double>(extracted_data.lines.back().word_count + 1);
                current_line_height = std::max(current_line_height, height);
            }

            auto& line = extracted_data.lines.back();
            if (!line.text.empty()) {
                line.text += ' ';
            }
            line.text += word;
            line.word_count = countWords(line.text);

            if (!text_box.has_font_info()) {
                continue;
            }

            const double size = text_box.get_font_size();
            if (!std::isfinite(size) || size <= 0.0) {
                continue;
            }

            const double normalized =
                std::round(size * precision_scale) / precision_scale;
            line.font_sizes.push_back(normalized);
            extracted_data.ordered_font_sizes.push_back(normalized);
            ++extracted_data.font_size_frequency[normalized];
        }
    }

    if (extracted_data.font_size_frequency.empty()) {
        return {
            false,
            "No extractable text with font information was found. "
            "The PDF may be scanned or contain outlined text."
        };
    }

    std::size_t highest_frequency = 0;
    for (const auto& [size, frequency] : extracted_data.font_size_frequency) {
        if (frequency > highest_frequency) {
            extracted_data.body_font_size = size;
            highest_frequency = frequency;
        }
    }

    return {true, ""};
}

} // namespace rag
