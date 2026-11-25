#include "font_size_validator.hpp"

#include <cmath>
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

FontSizeValidator::FontSizeValidator(ValidatorConfig config)
    : config_(std::move(config)) {}

const std::map<int, double>& FontSizeValidator::defaultHeadingFontSizes() {
    static const ValidatorConfig defaults;
    return defaults.heading_font_sizes;
}

ValidationResult FontSizeValidator::validateConfiguration() const {
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

ValidationResult FontSizeValidator::validate(
    const std::map<int, double>& heading_font_sizes
) const {
    const auto config_result = validateConfiguration();
    if (!config_result.is_valid) {
        return config_result;
    }

    if (heading_font_sizes.empty()) {
        return {false, "No heading font sizes were provided."};
    }

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

        const auto expected = config_.heading_font_sizes.find(heading_level);
        if (expected == config_.heading_font_sizes.end()) {
            return {false, "No expected font size is configured for H" +
                std::to_string(heading_level) + "."};
        }

        if (std::fabs(actual_font_size - expected->second) >
            config_.heading_font_size_tolerance_points) {
            return {
                false,
                "H" + std::to_string(heading_level) + " font size is " +
                    formatFontSize(actual_font_size) + " pt; expected " +
                    formatFontSize(expected->second) + " pt (tolerance: +/- " +
                    formatFontSize(config_.heading_font_size_tolerance_points) + " pt)."
            };
        }
    }

    return {true, ""};
}

} // namespace rag
