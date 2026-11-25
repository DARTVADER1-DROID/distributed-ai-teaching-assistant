#include "validator_service.hpp"

#include <cmath>

namespace rag {

bool ValidatorService::hasConsistentHeadingFontSizes(
    const std::map<int, double>& heading_font_sizes
) const {
    if (heading_font_sizes.empty()) {
        return false;
    }

    double previous_font_size = 0.0;
    bool is_first_heading = true;

    for (const auto& [heading_level, font_size] : heading_font_sizes) {
        if (heading_level < 1 || heading_level > 6 ||
            !std::isfinite(font_size) || font_size <= 0.0) {
            return false;
        }

        if (!is_first_heading && font_size >= previous_font_size) {
            return false;
        }

        previous_font_size = font_size;
        is_first_heading = false;
    }

    return true;
}

} // namespace rag
