#pragma once

#include <map>
#include <string>

namespace rag {

struct ValidationResult {
    bool is_valid;
    std::string reason;
};

class ValidatorService {
public:
    ValidatorService() = default;

    // Default PDF heading sizes, expressed in points.
    static const std::map<int, double>& defaultHeadingFontSizes();

    // Compares supplied PDF heading sizes against defaults.
    // Keys are heading levels (1 = H1, ... 6 = H6).
    // Missing heading levels are allowed.
    // A valid result has an empty reason; an invalid result explains why.
    ValidationResult hasConsistentHeadingFontSizes(
        const std::map<int, double>& heading_font_sizes
    ) const;

private:
    static constexpr double FONT_SIZE_TOLERANCE_POINTS = 0.5;
};

} // namespace rag
