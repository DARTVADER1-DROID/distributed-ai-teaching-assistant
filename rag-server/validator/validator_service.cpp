#include "validator_service.hpp"

#include <poppler/cpp/poppler-document.h>
#include <poppler/cpp/poppler-page.h>

#include <cmath>
#include <fstream>
#include <iterator>
#include <limits>
#include <memory>
#include <sstream>
#include <utility>

namespace rag {
namespace {

std::string formatFontSize(double font_size) {
    std::ostringstream output;
    output << font_size;
    return output.str();
}

} // namespace

ValidatorService::ValidatorService(ValidatorConfig config)
    : config_(std::move(config)),
      font_size_validator_(config_),
      heading_level_validator_() {}

const std::map<int, double>& ValidatorService::defaultHeadingFontSizes() {
    return FontSizeValidator::defaultHeadingFontSizes();
}

ValidationResult ValidatorService::hasConsistentHeadingFontSizes(
    const std::map<int, double>& heading_font_sizes
) const {
    return font_size_validator_.validate(heading_font_sizes);
}

ValidationResult ValidatorService::hasValidHeadingLevelTraversal(
    const std::vector<int>& heading_levels
) const {
    return heading_level_validator_.validate(heading_levels);
}

ValidationResult ValidatorService::validatePdf(
    const std::vector<std::uint8_t>& pdf_data
) const {
    const auto config_result = font_size_validator_.validateConfiguration();
    if (!config_result.is_valid) {
        return config_result;
    }
    return extractAndValidateHeadingFontSizes(pdf_data);
}

ValidationResult ValidatorService::validatePdfFile(
    const std::string& pdf_file_path
) const {
    const auto config_result = font_size_validator_.validateConfiguration();
    if (!config_result.is_valid) {
        return config_result;
    }

    if (pdf_file_path.empty()) {
        return {false, "PDF file path must not be empty."};
    }

    std::ifstream pdf_file(pdf_file_path, std::ios::binary);
    if (!pdf_file) {
        return {false, "Unable to open PDF file: " + pdf_file_path};
    }

    std::vector<std::uint8_t> pdf_data(
        (std::istreambuf_iterator<char>(pdf_file)),
        std::istreambuf_iterator<char>()
    );

    if (pdf_file.bad()) {
        return {false, "Failed while reading PDF file: " + pdf_file_path};
    }

    return extractAndValidateHeadingFontSizes(pdf_data);
}

ValidationResult ValidatorService::extractAndValidateHeadingFontSizes(
    const std::vector<std::uint8_t>& pdf_data
) const {
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

    // The most frequent extracted font size is treated as body text.
    std::map<double, std::size_t> font_size_frequency;
    std::vector<double> ordered_font_sizes;

    const double precision_scale =
        std::pow(10.0, config_.font_size_precision_decimal_places);

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

            const double font_size = text_box.get_font_size();
            if (!std::isfinite(font_size) || font_size <= 0.0) {
                continue;
            }

            const double normalized_size =
                std::round(font_size * precision_scale) / precision_scale;
            ++font_size_frequency[normalized_size];
            ordered_font_sizes.push_back(normalized_size);
        }
    }

    if (font_size_frequency.empty()) {
        return {
            false,
            "No extractable text with font information was found. "
            "The PDF may be scanned or contain outlined text."
        };
    }

    // Determine the most common font size, breaking ties toward the smaller size.
    double body_font_size = 0.0;
    std::size_t highest_frequency = 0;
    for (const auto& [font_size, frequency] : font_size_frequency) {
        if (frequency > highest_frequency) {
            body_font_size = font_size;
            highest_frequency = frequency;
        }
    }

    const auto& expected_sizes = config_.heading_font_sizes;
    std::map<int, double> detected_heading_sizes;
    bool found_heading_candidate = false;

    for (const auto& [font_size, frequency] : font_size_frequency) {
        (void)frequency;

        if (font_size <= body_font_size + config_.body_font_size_tolerance_points) {
            continue;
        }

        found_heading_candidate = true;
        int matched_level = 0;
        double smallest_difference = std::numeric_limits<double>::max();

        for (const auto& [heading_level, expected_size] : expected_sizes) {
            const double difference = std::fabs(font_size - expected_size);
            if (difference < smallest_difference) {
                smallest_difference = difference;
                matched_level = heading_level;
            }
        }

        if (smallest_difference > config_.heading_font_size_tolerance_points) {
            return {
                false,
                "Detected non-body text at " + formatFontSize(font_size) +
                    " pt, but it does not match any configured heading size "
                    "(H1-H6, tolerance +/- " +
                    formatFontSize(config_.heading_font_size_tolerance_points) + " pt)."
            };
        }

        const auto existing = detected_heading_sizes.find(matched_level);
        if (existing != detected_heading_sizes.end() &&
            std::fabs(existing->second - font_size) >
                config_.heading_font_size_tolerance_points) {
            return {
                false,
                "H" + std::to_string(matched_level) +
                    " uses inconsistent font sizes: " +
                    formatFontSize(existing->second) + " pt and " +
                    formatFontSize(font_size) + " pt."
            };
        }

        detected_heading_sizes[matched_level] = font_size;
    }

    if (!found_heading_candidate || detected_heading_sizes.empty()) {
        return {
            false,
            "No heading font sizes could be identified. "
            "The PDF may contain only body text, or its headings may use "
            "the same size as the body text."
        };
    }

    // Reconstruct heading-level order from Poppler's extracted text-box order.
    std::vector<int> detected_heading_levels;
    for (const double font_size : ordered_font_sizes) {
        if (font_size <= body_font_size + config_.body_font_size_tolerance_points) {
            continue;
        }

        int matched_level = 0;
        double smallest_difference = std::numeric_limits<double>::max();
        for (const auto& [heading_level, expected_size] : expected_sizes) {
            const double difference = std::fabs(font_size - expected_size);
            if (difference < smallest_difference) {
                smallest_difference = difference;
                matched_level = heading_level;
            }
        }

        if (smallest_difference <= config_.heading_font_size_tolerance_points) {
            detected_heading_levels.push_back(matched_level);
        }
    }

    // Run the independent validators in a deterministic sequence.
    const auto font_result =
        font_size_validator_.validate(detected_heading_sizes);
    if (!font_result.is_valid) {
        return font_result;
    }

    return heading_level_validator_.validate(detected_heading_levels);
}

} // namespace rag
