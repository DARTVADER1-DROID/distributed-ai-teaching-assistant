#include "validator_service.hpp"

#include <cmath>

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

bool ValidatorService::hasConsistentHeadingFontSizes(
    const std::map<int, double>& heading_font_sizes
) const {
    if (heading_font_sizes.empty()) {
        return false;
    }

    const auto& default_sizes = defaultHeadingFontSizes();

    for (const auto& [heading_level, actual_font_size] : heading_font_sizes) {
        if (heading_level < 1 || heading_level > 6 ||
            !std::isfinite(actual_font_size) || actual_font_size <= 0.0) {
            return false;
        }

        const auto expected = default_sizes.find(heading_level);
        if (expected == default_sizes.end()) {
            return false;
        }

        if (std::fabs(actual_font_size - expected->second) >
            FONT_SIZE_TOLERANCE_POINTS) {
            return false;
        }
    }

    return true;
}

} // namespace rag
