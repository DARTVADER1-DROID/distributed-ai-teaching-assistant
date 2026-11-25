#include "validator_service.hpp"

#include <cmath>
#include <string>

namespace rag {

const std::map<int, double>& ValidatorService::defaultHeadingFontSizes() {
    static const std::map<int, double> default_sizes{
        {1, 24.0},
        {2, 20.0},
        {3, 18.0},
        {4, 16.0},
        {5, 14.0},
        {6, 12.0}
    };

    return default_sizes;
}

ValidationResult ValidatorService::hasConsistentHeadingFontSizes(
    const std::map<int, double>& heading_font_sizes
) const {
    if (heading_font_sizes.empty()) {
        return {false, "No heading font sizes were provided."};
    }

    const auto& default_sizes = defaultHeadingFontSizes();

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

        const double expected_font_size = default_sizes.at(heading_level);
        if (std::fabs(actual_font_size - expected_font_size) >
            FONT_SIZE_TOLERANCE_POINTS) {
            return {
                false,
                "H" + std::to_string(heading_level) + " font size is " +
                    std::to_string(actual_font_size) + " pt; expected " +
                    std::to_string(expected_font_size) + " pt (tolerance: +/- " +
                    std::to_string(FONT_SIZE_TOLERANCE_POINTS) + " pt)."
            };
        }
    }

    return {true, ""};
}

} // namespace rag
