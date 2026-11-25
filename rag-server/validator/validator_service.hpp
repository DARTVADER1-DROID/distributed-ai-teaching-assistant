#pragma once

#include <map>

namespace rag {

class ValidatorService {
public:
    ValidatorService() = default;

    // Default PDF heading sizes, expressed in points.
    static const std::map<int, double>& defaultHeadingFontSizes();

    // Compares the supplied PDF heading sizes against the defaults.
    // Keys are heading levels (1 = H1, ... 6 = H6).
    // Missing heading levels are allowed.
    bool hasConsistentHeadingFontSizes(
        const std::map<int, double>& heading_font_sizes
    ) const;

private:
    static constexpr double FONT_SIZE_TOLERANCE_POINTS = 0.5;
};

} // namespace rag
