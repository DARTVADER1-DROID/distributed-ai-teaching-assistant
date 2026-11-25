#include "pdf_font_size_extractor.hpp"

#include <poppler/cpp/poppler-document.h>
#include <poppler/cpp/poppler-page.h>

#include <cmath>
#include <limits>
#include <memory>
#include <string>

namespace rag {

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
            return {false, "Failed to read PDF page " +
                std::to_string(page_index + 1) + "."};
        }

        const auto text_boxes =
            page->text_list(poppler::page::text_list_include_font);

        for (const auto& text_box : text_boxes) {
            if (!text_box.has_font_info()) {
                continue;
            }

            const double size = text_box.get_font_size();
            if (!std::isfinite(size) || size <= 0.0) {
                continue;
            }

            const double normalized =
                std::round(size * precision_scale) / precision_scale;
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
