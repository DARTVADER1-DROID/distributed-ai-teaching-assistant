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

std::string trim(const std::string& value) {
    const auto first = value.find_first_not_of(" \t\r\n");
    if (first == std::string::npos) {
        return {};
    }

    const auto last = value.find_last_not_of(" \t\r\n");
    return value.substr(first, last - first + 1);
}

int detectHeadingLevel(
    const ExtractedPdfLine& line,
    const ExtractedPdfData& extracted_data,
    const ValidatorConfig& config
) {
    int line_level = 0;
    double largest_heading_size = 0.0;

    for (const double font_size : line.font_sizes) {
        if (font_size <= extracted_data.body_font_size +
                config.body_font_size_tolerance_points) {
            continue;
        }

        int matched_level = 0;
        double smallest_difference = std::numeric_limits<double>::max();

        for (const auto& [level, expected_size] : config.heading_font_sizes) {
            const double difference = std::fabs(font_size - expected_size);
            if (difference < smallest_difference) {
                smallest_difference = difference;
                matched_level = level;
            }
        }

        if (smallest_difference <= config.heading_font_size_tolerance_points &&
            font_size > largest_heading_size) {
            largest_heading_size = font_size;
            line_level = matched_level;
        }
    }

    return line_level;
}

struct ActiveHeading {
    int level;
    const ExtractedPdfLine* line;
};

} // namespace

HeadingLevelValidator::HeadingLevelValidator(ValidatorConfig config)
    : config_(std::move(config)) {}

ValidationReport HeadingLevelValidator::validate(
    const ExtractedPdfData& extracted_data
) const {
    ValidationReport report;

    if (extracted_data.lines.empty()) {
        report.addIssue({
            "No extracted PDF lines were provided for heading hierarchy validation."
        });
        return report;
    }

    constexpr const char* end_marker = "End of topic.";
    std::vector<ActiveHeading> active_headings;
    bool detected_any_heading = false;

    for (const auto& line : extracted_data.lines) {
        const int line_level = detectHeadingLevel(
            line,
            extracted_data,
            config_
        );

        if (line_level == 0) {
            continue;
        }

        detected_any_heading = true;
        const bool is_end_marker = trim(line.text) == end_marker;

        if (is_end_marker) {
            if (active_headings.empty()) {
                report.addIssue(issueAtLine(
                    "Unexpected heading closure at H" +
                        std::to_string(line_level) +
                        ": there is no active heading to close.",
                    line
                ));
                continue;
            }

            const int active_level = active_headings.back().level;
            if (active_level != line_level) {
                report.addIssue(issueAtLine(
                    "Invalid heading closure at H" +
                        std::to_string(line_level) +
                        ": the currently active heading is H" +
                        std::to_string(active_level) +
                        ". Close nested headings in reverse order before closing their parent.",
                    line
                ));
                continue;
            }

            active_headings.pop_back();
            continue;
        }

        if (active_headings.empty()) {
            active_headings.push_back({line_level, &line});
            continue;
        }

        const int active_level = active_headings.back().level;

        if (line_level <= active_level) {
            report.addIssue(issueAtLine(
                "Heading H" + std::to_string(line_level) +
                    " starts while H" + std::to_string(active_level) +
                    " is still open. Add an H" +
                    std::to_string(active_level) +
                    " 'End of topic.' line before opening this heading.",
                line
            ));
            continue;
        }

        if (line_level != active_level + 1) {
            report.addIssue(issueAtLine(
                "Invalid heading level transition from H" +
                    std::to_string(active_level) + " to H" +
                    std::to_string(line_level) +
                    ". Heading levels may descend by only one level at a time.",
                line
            ));
            continue;
        }

        active_headings.push_back({line_level, &line});
    }

    if (!detected_any_heading) {
        report.addIssue({
            "No heading levels could be derived from the extracted PDF lines."
        });
        return report;
    }

    for (auto it = active_headings.rbegin();
         it != active_headings.rend();
         ++it) {
        report.addIssue(issueAtLine(
            "Heading H" + std::to_string(it->level) +
                " was not explicitly closed. Add an H" +
                std::to_string(it->level) +
                " 'End of topic.' line before the document ends.",
            *it->line
        ));
    }

    return report;
}

} // namespace rag
