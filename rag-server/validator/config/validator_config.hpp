#pragma once

#include <map>

namespace rag {

// Runtime-tunable settings for PDF heading and paragraph font validation.
struct ValidatorConfig {
    // Expected heading sizes in PDF points. Keys are levels 1 (H1) through 6 (H6).
    std::map<int, double> heading_font_sizes{
        {1, 24.0},
        {2, 20.0},
        {3, 18.0},
        {4, 16.0},
        {5, 14.0},
        {6, 12.0}
    };

    // Maximum allowed difference from a configured heading size.
    double heading_font_size_tolerance_points = 0.5;

    // A font size must exceed the detected body size by this amount to be
    // considered a heading candidate.
    double body_font_size_tolerance_points = 0.5;

    // Maximum allowed difference between paragraph text and the detected
    // body-font baseline.
    double paragraph_font_size_tolerance_points = 0.5;

    // Decimal places retained when normalizing font sizes extracted by Poppler.
    int font_size_precision_decimal_places = 2;
};

} // namespace rag
