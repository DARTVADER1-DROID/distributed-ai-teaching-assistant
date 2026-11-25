#include "font_size_validator.hpp"

#include <cmath>
#include <limits>
#include <map>
#include <sstream>
#include <set>
#include <string>
#include <utility>

namespace rag {
namespace {

std::string formatFontSize(double font_size) {
    std::ostringstream output;
    output << font_size;
    return output.str();
}

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

FontSizeValidator::FontSizeValidator(ValidatorConfig config)
    : config_(std::move(config)) {}

ValidationReport FontSizeValidator::validateConfiguration() const {
    ValidationReport report;

    if (config_.heading_font_sizes.empty()) {
        report.addIssue({"Configuration has no heading font sizes."});
        return report;
    }

    for (const auto& [level, size] : config_.heading_font_sizes) {
        if (level < 1 || level > 6) {
            report.addIssue({
                "Configuration contains an invalid heading level; expected H1-H6."
            });
        }
        if (!std::isfinite(size) || size <= 0.0) {
            report.addIssue({
                "Configured heading font sizes must be finite and greater than zero."
            });
        }
    }

    if (!std::isfinite(config_.heading_font_size_tolerance_points) ||
        config_.heading_font_size_tolerance_points < 0.0) {
        report.addIssue({
            "Heading font-size tolerance must be finite and non-negative."
        });
    }
    if (!std::isfinite(config_.body_font_size_tolerance_points) ||
        config_.body_font_size_tolerance_points < 0.0) {
        report.addIssue({
            "Body font-size tolerance must be finite and non-negative."
        });
    }
    if (config_.font_size_precision_decimal_places < 0 ||
        config_.font_size_precision_decimal_places > 6) {
        report.addIssue({
            "Font-size precision must be between 0 and 6 decimal places."
        });
    }

    return report;
}

ValidationReport FontSizeValidator::validate(
    const ExtractedPdfData& extracted_data
) const {
    ValidationReport report = validateConfiguration();
    if (!report.isValid()) {
        return report;
    }

    if (extracted_data.font_size_frequency.empty()) {
        report.addIssue({"No extracted font sizes were provided."});
        return report;
    }

    std::map<int, double> detected_heading_sizes;

    for (const auto& line : extracted_data.lines) {
        // A text line may contain one text box per word; check each distinct
        // font size once per line to avoid duplicate issues for the same rule break.
        const std::set<double> line_font_sizes(
            line.font_sizes.begin(), line.font_sizes.end()
        );
        for (const double font_size : line_font_sizes) {
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

            if (smallest_difference > config_.heading_font_size_tolerance_points) {
                report.addIssue(issueAtLine(
                    "Detected non-body text at " + formatFontSize(font_size) +
                        " pt, but it does not match any configured heading size "
                        "(H1-H6, tolerance +/- " +
                        formatFontSize(config_.heading_font_size_tolerance_points) + " pt).",
                    line
                ));
                continue;
            }

            const auto existing = detected_heading_sizes.find(matched_level);
            if (existing != detected_heading_sizes.end() &&
                std::fabs(existing->second - font_size) >
                    config_.heading_font_size_tolerance_points) {
                report.addIssue(issueAtLine(
                    "H" + std::to_string(matched_level) +
                        " uses inconsistent font sizes: " +
                        formatFontSize(existing->second) + " pt and " +
                        formatFontSize(font_size) + " pt.",
                    line
                ));
                continue;
            }

            if (existing == detected_heading_sizes.end()) {
                detected_heading_sizes[matched_level] = font_size;
            }
        }
    }

    if (detected_heading_sizes.empty() && report.isValid()) {
        report.addIssue({
            "No heading font sizes could be identified. The PDF may contain "
            "only body text, or its headings may use the same size as body text."
        });
    }

    return report;
}

} // namespace rag
