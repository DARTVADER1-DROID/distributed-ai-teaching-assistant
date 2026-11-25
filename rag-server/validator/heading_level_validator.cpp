#include "heading_level_validator.hpp"

#include <cmath>
#include <limits>
#include <string>
#include <utility>
#include <vector>

namespace rag {
namespace {

ValidationIssue issueAtLine(
    std::string reason,
    const ExtractedPdfLine& line
) {
    reason += " Page " + std::to_string(line.page_number) +
        ", line " + std::to_string(line.line_number) +
        " (" + std::to_string(line.word_count) + " words).";

    return {
        std::move(reason),
        line.page_number,
        line.line_number,
        line.word_count,
        line.text
    };
}

} // namespace

HeadingLevelValidator::HeadingLevelValidator(ValidatorConfig config)
    : config_(std::move(config)) {}

ValidationReport HeadingLevelValidator::validate(
    const ExtractedPdfData& extracted_data
) const {
    ValidationReport report;

    if (extracted_data.lines.empty()) {
        report.addIssue({
            "No extracted PDF lines were provided for traversal validation."
        });
        return report;
    }

    struct DetectedHeading {
        int level;
        const ExtractedPdfLine* line;
    };

    std::vector<DetectedHeading> headings;

    for (const auto& line : extracted_data.lines) {
        int line_level = 0;
        double largest_heading_size = 0.0;

        for (const double font_size : line.font_sizes) {
            if (font_size <= extracted_data.body_font_size +
                    config_.body_font_size_tolerance_points) {
                continue;
            }

            int matched_level = 0;
            double smallest_difference = std::numeric_limits<double>::max();
            for (const auto& [level, expected_size] : config_.heading_font_sizes) {
                const double difference = std::fabs(font_size - expected_size);
                if (difference < smallest_difference) {
                    smallest_difference = difference;
                    matched_level = level;
                }
            }

            if (smallest_difference <= config_.heading_font_size_tolerance_points &&
                font_size > largest_heading_size) {
                largest_heading_size = font_size;
                line_level = matched_level;
            }
        }

        if (line_level != 0) {
            headings.push_back({line_level, &line});
        }
    }

    if (headings.empty()) {
        report.addIssue({
            "No heading levels could be derived from the extracted PDF lines."
        });
        return report;
    }

    for (std::size_t index = 1; index < headings.size(); ++index) {
        const int previous = headings[index - 1].level;
        const int current = headings[index].level;

        if (std::abs(current - previous) > 1) {
            report.addIssue(issueAtLine(
                "Invalid heading level transition from H" +
                    std::to_string(previous) + " to H" +
                    std::to_string(current) +
                    ". Heading levels may change by only one level at a time.",
                *headings[index].line
            ));
        }
    }

    return report;
}

} // namespace rag
