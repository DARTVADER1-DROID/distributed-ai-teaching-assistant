#pragma once

#include <map>

namespace rag {

class ValidatorService {
public:
    ValidatorService() = default;

    // Checks that supplied heading sizes are positive and strictly decrease
    // from higher-level headings (H1) to lower-level headings (H6).
    // Missing heading levels are allowed. Keys must be in the range [1, 6].
    bool hasConsistentHeadingFontSizes(
        const std::map<int, double>& heading_font_sizes
    ) const;
};

} // namespace rag
