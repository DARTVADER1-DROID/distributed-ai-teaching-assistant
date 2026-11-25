#pragma once

#include <cstdint>
#include <map>
#include <string>
#include <vector>

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

    // Validate heading font sizes already extracted from a PDF.
    // Keys are heading levels (1 = H1, ... 6 = H6).
    ValidationResult hasConsistentHeadingFontSizes(
        const std::map<int, double>& heading_font_sizes
    ) const;

    // Validate a PDF supplied as its raw binary contents.
    ValidationResult validatePdf(
        const std::vector<std::uint8_t>& pdf_data
    ) const;

    // Convenience overload for a PDF stored on disk.
    ValidationResult validatePdfFile(
        const std::string& pdf_file_path
    ) const;

private:
    static constexpr double FONT_SIZE_TOLERANCE_POINTS = 0.5;

    ValidationResult extractAndValidateHeadingFontSizes(
        const std::vector<std::uint8_t>& pdf_data
    ) const;
};

} // namespace rag
