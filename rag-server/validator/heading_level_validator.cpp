#include "heading_level_validator.hpp"

#include <cmath>
#include <limits>
#include <string>
#include <utility>
#include <vector>

namespace rag {

HeadingLevelValidator::HeadingLevelValidator(ValidatorConfig config)
    : config_(std::move(config)) {}

ValidationResult HeadingLevelValidator::validate(
    const ExtractedPdfData& extracted_data
) const {
    if (extracted_data.ordered_font_sizes.empty()) {
        return {false, "No extracted font sizes were provided for traversal validation."};
    }

    std::vector<int> heading_levels;
    for (const double font_size : extracted_data.ordered_font_sizes) {
        if (font_size <= extracted_data.body_font_size +
                config_.body_font_size_tolerance_points) {
            continue;
        }

        int matched_level = 0;
        double smallest_difference = std::numeric_limits<double>::max();
        for (const auto& [level, expected_size] : config_.heading_font_sizes) {
            const double difference = std::fabs(font_size - expected_size);
            if (difference < smallest_difference) {
                smallest_difference = difference;
                matched_level = level;
            }
        }

        if (smallest_difference <= config_.heading_font_size_tolerance_points) {
            heading_levels.push_back(matched_level);
        }
    }

    if (heading_levels.empty()) {
        return {false, "No heading levels could be derived from the extracted PDF font sizes."};
    }

    for (std::size_t index = 1; index < heading_levels.size(); ++index) {
        const int previous = heading_levels[index - 1];
        const int current = heading_levels[index];

        if (std::abs(current - previous) > 1) {
            return {
                false,
                "Invalid heading level transition at position " +
                    std::to_string(index) + " to " + std::to_string(index + 1) +
                    ": H" + std::to_string(previous) + " -> H" +
                    std::to_string(current) +
                    ". Heading levels may change by only one level at a time."
            };
        }
    }

    return {true, ""};
}

} // namespace rag
