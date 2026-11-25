#include "validator_service.hpp"

#include <poppler/cpp/poppler-document.h>
#include <poppler/cpp/poppler-page.h>

#include <cmath>
#include <fstream>
#include <iterator>
#include <limits>
#include <memory>
#include <utility>
#include <sstream>

namespace rag {
namespace {

std::string formatFontSize(double font_size) {
    std::ostringstream output;
    output << font_size;
    return output.str();
}

} // namespace

ValidatorService::ValidatorService(ValidatorConfig config)
    : config_(std::move(config)) {}

const std::map<int, double>& ValidatorService::defaultHeadingFontSizes() {
    static const ValidatorConfig defaults;
    return defaults.heading_font_sizes;
}

ValidationResult ValidatorService::validateConfiguration() const {
    if (config_.heading_font_sizes.empty()) {
        return {false, "Configuration has no heading font sizes."};
    }

    for (const auto& [level, size] : config_.heading_font_sizes) {
        if (level < 1 || level > 6) {
            return {false, "Configuration contains an invalid heading level; expected H1-H6."};
        }
        if (!std::isfinite(size) || size <= 0.0) {
            return {false, "Configured heading font sizes must be finite and greater than zero."};
        }
    }

    if (!std::isfinite(config_.heading_font_size_tolerance_points) ||
        config_.heading_font_size_tolerance_points < 0.0) {
        return {false, "Heading font-size tolerance must be finite and non-negative."};
    }
    if (!std::isfinite(config_.body_font_size_tolerance_points) ||
        config_.body_font_size_tolerance_points < 0.0) {
        return {false, "Body font-size tolerance must be finite and non-negative."};
    }
    if (config_.font_size_precision_decimal_places < 0 ||
        config_.font_size_precision_decimal_places > 6) {
        return {false, "Font-size precision must be between 0 and 6 decimal places."};
    }

    return {true, ""};
}

ValidationResult ValidatorService::hasConsistentHeadingFontSizes(
    const std::map<int, double>& heading_font_sizes
) const {
    const auto config_result = validateConfiguration();
    if (!config_result.is_valid) return config_result;

    if (heading_font_sizes.empty()) {
        return {false, "No heading font sizes were provided."};
    }

    const auto& default_sizes = config_.heading_font_sizes;

    for (const auto& [heading_level, actual_font_size] : heading_font_sizes) {
        if (heading_level < 1 || heading_level > 6) {
            return {false, "Invalid heading level " +
                std::to_string(heading_level) + "; expected a level from H1 to H6."};
        }

        if (!std::isfinite(actual_font_size)) {
            return {false, "H" + std::to_string(heading_level) +
                " has a non-finite font size."};
        }

        if (actual_font_size <= 0.0) {
            return {false, "H" + std::to_string(heading_level) +
                " has a font size that must be greater than zero."};
        }

        const auto expected = default_sizes.find(heading_level);
        if (expected == default_sizes.end()) {
            return {false, "No expected font size is configured for H" +
                std::to_string(heading_level) + "."};
        }
        const double expected_font_size = expected->second;
        if (std::fabs(actual_font_size - expected_font_size) >
            config_.heading_font_size_tolerance_points) {
            return {
                false,
                "H" + std::to_string(heading_level) + " font size is " +
                    formatFontSize(actual_font_size) + " pt; expected " +
                    formatFontSize(expected_font_size) + " pt (tolerance: +/- " +
                    formatFontSize(config_.heading_font_size_tolerance_points) + " pt)."
            };
        }
    }

    return {true, ""};
}

ValidationResult ValidatorService::hasValidHeadingLevelTraversal(
    const std::vector<int>& heading_levels
) const {
    if (heading_levels.empty()) {
        return {false, "No heading levels were provided for traversal validation."};
    }

    for (std::size_t index = 0; index < heading_levels.size(); ++index) {
        const int current_level = heading_levels[index];
        if (current_level < 1 || current_level > 6) {
            return {
                false,
                "Invalid heading level at position " + std::to_string(index + 1) +
                    ": H" + std::to_string(current_level) + "; expected H1-H6."
            };
        }

        if (index == 0) {
            continue;
        }

        const int previous_level = heading_levels[index - 1];
        if (std::abs(current_level - previous_level) > 1) {
            return {
                false,
                "Invalid heading level transition at position " +
                    std::to_string(index) + " to " + std::to_string(index + 1) +
                    ": H" + std::to_string(previous_level) + " -> H" +
                    std::to_string(current_level) +
                    ". Heading levels may change by only one level at a time."
            };
        }
    }

    return {true, ""};
}

ValidationResult ValidatorService::validatePdf(
    const std::vector<std::uint8_t>& pdf_data
) const {
    const auto config_result = validateConfiguration();
    if (!config_result.is_valid) return config_result;
    return extractAndValidateHeadingFontSizes(pdf_data);
}

ValidationResult ValidatorService::validatePdfFile(
    const std::string& pdf_file_path
) const {
    const auto config_result = validateConfiguration();
    if (!config_result.is_valid) return config_result;

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

    // Count extracted word font sizes. The most frequent size is treated as
    // the document's body-text size; larger sizes are heading candidates.
    std::map<double, std::size_t> font_size_frequency;\n    std::vector<double> ordered_font_sizes;

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

            // Normalize insignificant floating-point noise from PDF font data.
            const double precision_scale =
                std::pow(10.0, config_.font_size_precision_decimal_places);
            const double normalized_size =
                std::round(font_size * precision_scale) / precision_scale;
            ++font_size_frequency[normalized_size];\n            ordered_font_sizes.push_back(normalized_size);
        }
    }

    if (font_size_frequency.empty()) {
        return {
            false,
            "No extractable text with font information was found. "
            "The PDF may be scanned or contain outlined text."
        };
    }

    // Determine the most common font size, breaking ties in favor of the
    // smaller size because body text is usually smaller than headings.
    double body_font_size = 0.0;
    std::size_t highest_frequency = 0;
    for (const auto& [font_size, frequency] : font_size_frequency) {
        if (frequency > highest_frequency) {
            body_font_size = font_size;
            highest_frequency = frequency;
        }
    }

    const auto& defaults = config_.heading_font_sizes;
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

        for (const auto& [heading_level, expected_size] : defaults) {
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

        const auto individual_result = hasConsistentHeadingFontSizes(
            {{matched_level, font_size}}
        );
        if (!individual_result.is_valid) {
            return individual_result;
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

    // Reconstruct heading-level order from the extracted text sequence.
    // Font-size-based classification is heuristic; text boxes are processed
    // in the order returned by Poppler for each page.
    std::vector<int> detected_heading_levels;
    for (const double font_size : ordered_font_sizes) {
        if (font_size <= body_font_size + config_.body_font_size_tolerance_points) {
            continue;
        }

        int matched_level = 0;
        double smallest_difference = std::numeric_limits<double>::max();
        for (const auto& [heading_level, expected_size] : defaults) {
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

    const auto traversal_result =
        hasValidHeadingLevelTraversal(detected_heading_levels);
    if (!traversal_result.is_valid) {
        return traversal_result;
    }

    return hasConsistentHeadingFontSizes(detected_heading_sizes);
}

} // namespace rag
