#pragma once

#include <map>

namespace rag {

// Shared typography rules used by document validation and extraction.
// Font sizes are expressed in PDF points.
struct DocumentFormatConfig {
    // Expected heading sizes. Keys are heading levels 1 (H1) through 6 (H6).
    std::map<int, double> heading_font_sizes{
        {1, 24.0},
        {2, 20.0},
        {3, 18.0},
        {4, 16.0},
        {5, 14.0},
        {6, 12.0}
    };

    // Maximum difference from a configured heading size.
    double heading_font_size_tolerance_points = 0.5;

    // Minimum difference above the detected body size for a line to be
    // considered a heading candidate.
    double body_font_size_tolerance_points = 0.5;

    // Maximum difference allowed from the detected body-font baseline
    // for paragraph/body text.
    double paragraph_font_size_tolerance_points = 0.5;

    // Decimal places retained when normalizing extracted font sizes.
    int font_size_precision_decimal_places = 2;
};

} // namespace rag
