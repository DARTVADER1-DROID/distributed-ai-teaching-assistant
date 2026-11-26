#include "extractor_service.hpp"

#include <poppler/cpp/poppler-document.h>
#include <poppler/cpp/poppler-page.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <map>
#include <memory>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace rag {
namespace {

struct ExtractedLine {
    std::size_t page_number = 0;
    std::size_t line_number = 0;
    std::string text;
    std::vector<double> font_sizes;
    double top = 0.0;
    double bottom = 0.0;
    double height = 1.0;
};

struct HeadingFrame {
    int level = 0;
    std::vector<std::size_t> path;
};

struct ParagraphFrame {
    bool active = false;
    std::vector<std::size_t> parent_path;
    std::size_t child_index = 0;
    std::size_t page_number = 0;
    double previous_bottom = 0.0;
    double previous_height = 1.0;
};

double verticalCenter(const poppler::rectf& bounds) {
    return bounds.top() + bounds.height() / 2.0;
}

bool belongsToLine(
    const poppler::rectf& bounds,
    double line_center,
    double line_height
) {
    const double center = verticalCenter(bounds);
    const double tolerance =
        std::max(2.0, std::min(bounds.height(), line_height) * 0.5);
    return std::fabs(center - line_center) <= tolerance;
}

DocumentNode* nodeAtPath(
    DocumentNode& root,
    const std::vector<std::size_t>& path
) {
    DocumentNode* current = &root;
    for (const std::size_t index : path) {
        if (index >= current->children.size()) {
            return nullptr;
        }
        current = &current->children[index];
    }
    return current;
}

int headingLevelForLine(
    const ExtractedLine& line,
    double body_font_size,
    const DocumentFormatConfig& config
) {
    int matched_level = 0;
    double largest_heading_size = 0.0;

    const std::set<double> unique_sizes(
        line.font_sizes.begin(), line.font_sizes.end()
    );

    for (const double font_size : unique_sizes) {
        if (font_size <= body_font_size +
                config.body_font_size_tolerance_points) {
            continue;
        }

        int candidate_level = 0;
        double smallest_difference = std::numeric_limits<double>::max();

        for (const auto& [level, expected_size] : config.heading_font_sizes) {
            const double difference = std::fabs(font_size - expected_size);
            if (difference < smallest_difference) {
                smallest_difference = difference;
                candidate_level = level;
            }
        }

        if (candidate_level != 0 &&
            smallest_difference <= config.heading_font_size_tolerance_points &&
            font_size > largest_heading_size) {
            largest_heading_size = font_size;
            matched_level = candidate_level;
        }
    }

    return matched_level;
}

bool validConfig(const DocumentFormatConfig& config) {
    if (config.heading_font_sizes.empty() ||
        !std::isfinite(config.heading_font_size_tolerance_points) ||
        config.heading_font_size_tolerance_points < 0.0 ||
        !std::isfinite(config.body_font_size_tolerance_points) ||
        config.body_font_size_tolerance_points < 0.0 ||
        !std::isfinite(config.paragraph_font_size_tolerance_points) ||
        config.paragraph_font_size_tolerance_points < 0.0 ||
        config.font_size_precision_decimal_places < 0 ||
        config.font_size_precision_decimal_places > 6) {
        return false;
    }

    for (const auto& [level, size] : config.heading_font_sizes) {
        if (level < 1 || level > 6 || !std::isfinite(size) || size <= 0.0) {
            return false;
        }
    }
    return true;
}

} // namespace

ExtractorService::ExtractorService(DocumentFormatConfig config)
    : config_(std::move(config)) {}

ExtractionResult ExtractorService::extractPdf(
    const std::vector<std::uint8_t>& pdf_data
) const {
    ExtractionResult result;
    result.document.type = DocumentNodeType::Document;

    if (!validConfig(config_)) {
        result.error = "Document format configuration is invalid.";
        return result;
    }
    if (pdf_data.empty()) {
        result.error = "PDF data is empty.";
        return result;
    }
    if (pdf_data.size() >
        static_cast<std::size_t>(std::numeric_limits<int>::max())) {
        result.error = "PDF data is too large to parse.";
        return result;
    }

    const auto* raw_data = reinterpret_cast<const char*>(pdf_data.data());
    std::unique_ptr<poppler::document> pdf(
        poppler::document::load_from_raw_data(
            raw_data,
            static_cast<int>(pdf_data.size())
        )
    );

    if (!pdf) {
        result.error = "Unable to parse input as a valid PDF document.";
        return result;
    }
    if (pdf->is_locked()) {
        result.error = "PDF is encrypted or password-protected.";
        return result;
    }
    if (pdf->pages() <= 0) {
        result.error = "PDF contains no pages.";
        return result;
    }

    result.document.end_page_number =
        static_cast<std::size_t>(pdf->pages());

    const double precision_scale =
        std::pow(10.0, config_.font_size_precision_decimal_places);
    std::map<double, std::size_t> font_frequency;
    std::vector<ExtractedLine> lines;

    for (int page_index = 0; page_index < pdf->pages(); ++page_index) {
        std::unique_ptr<poppler::page> page(pdf->create_page(page_index));
        if (!page) {
            result.error =
                "Failed to read PDF page " + std::to_string(page_index + 1) + ".";
            return result;
        }

        const auto text_boxes =
            page->text_list(poppler::page::text_list_include_font);

        std::size_t page_line_number = 0;
        double current_line_center = 0.0;
        double current_line_height = 0.0;

        for (const auto& text_box : text_boxes) {
            const auto utf8_text = text_box.text().to_utf8();
            const std::string fragment(utf8_text.begin(), utf8_text.end());
            if (fragment.empty()) {
                continue;
            }

            const poppler::rectf bounds = text_box.bbox();
            const double center = verticalCenter(bounds);
            const double height = std::max(1.0, bounds.height());

            const bool starts_new_line =
                lines.empty() ||
                lines.back().page_number !=
                    static_cast<std::size_t>(page_index + 1) ||
                !belongsToLine(bounds, current_line_center, current_line_height);

            if (starts_new_line) {
                ++page_line_number;
                ExtractedLine line;
                line.page_number = static_cast<std::size_t>(page_index + 1);
                line.line_number = page_line_number;
                line.top = bounds.top();
                line.bottom = bounds.bottom();
                line.height = height;
                lines.push_back(std::move(line));
                current_line_center = center;
                current_line_height = height;
            } else {
                const std::size_t existing_fragments =
                    lines.back().font_sizes.size();
                const double weight =
                    static_cast<double>(std::max<std::size_t>(1, existing_fragments));
                current_line_center =
                    (current_line_center * weight + center) / (weight + 1.0);
                current_line_height = std::max(current_line_height, height);
                lines.back().top = std::min(lines.back().top, bounds.top());
                lines.back().bottom = std::max(lines.back().bottom, bounds.bottom());
                lines.back().height =
                    std::max(1.0, lines.back().bottom - lines.back().top);
            }

            auto& line = lines.back();
            if (!line.text.empty() && line.text.back() != ' ' &&
                !fragment.empty() && fragment.front() != ' ') {
                line.text += ' ';
            }
            line.text += fragment;

            if (text_box.has_font_info()) {
                const double font_size = text_box.get_font_size();
                if (std::isfinite(font_size) && font_size > 0.0) {
                    const double normalized =
                        std::round(font_size * precision_scale) / precision_scale;
                    line.font_sizes.push_back(normalized);
                    ++font_frequency[normalized];
                }
            }
        }
    }

    if (font_frequency.empty()) {
        result.error =
            "No extractable text with font information was found. "
            "The PDF may be scanned or contain outlined text.";
        return result;
    }

    double body_font_size = 0.0;
    std::size_t highest_frequency = 0;
    for (const auto& [font_size, frequency] : font_frequency) {
        if (frequency > highest_frequency) {
            body_font_size = font_size;
            highest_frequency = frequency;
        }
    }

    std::vector<HeadingFrame> heading_stack;
    ParagraphFrame paragraph;

    for (const auto& line : lines) {
        if (line.text.empty()) {
            continue;
        }

        const int heading_level =
            headingLevelForLine(line, body_font_size, config_);

        if (heading_level != 0) {
            paragraph.active = false;

            // A heading becomes a child of the nearest preceding heading
            // with a lower level. Missing levels do not create placeholders.
            while (!heading_stack.empty() &&
                   heading_stack.back().level >= heading_level) {
                heading_stack.pop_back();
            }

            std::vector<std::size_t> parent_path;
            if (!heading_stack.empty()) {
                parent_path = heading_stack.back().path;
            }

            DocumentNode* parent = nodeAtPath(result.document, parent_path);
            if (!parent) {
                result.error = "Internal hierarchy path became invalid.";
                return result;
            }

            DocumentNode heading;
            heading.type = DocumentNodeType::Heading;
            heading.heading_level = heading_level;
            heading.text = line.text;
            heading.page_number = line.page_number;
            heading.line_number = line.line_number;
            heading.end_page_number = line.page_number;
            heading.end_line_number = line.line_number;

            const std::size_t child_index = parent->children.size();
            parent->children.push_back(std::move(heading));

            std::vector<std::size_t> heading_path = parent_path;
            heading_path.push_back(child_index);
            heading_stack.push_back({heading_level, std::move(heading_path)});
            continue;
        }

        std::vector<std::size_t> parent_path;
        if (!heading_stack.empty()) {
            parent_path = heading_stack.back().path;
        }

        DocumentNode* parent = nodeAtPath(result.document, parent_path);
        if (!parent) {
            result.error = "Internal hierarchy path became invalid.";
            return result;
        }

        const double gap = paragraph.active &&
                paragraph.page_number == line.page_number
            ? std::max(0.0, line.top - paragraph.previous_bottom)
            : std::numeric_limits<double>::max();
        const double paragraph_gap_limit =
            std::max(4.0, line.height * 0.75);

        DocumentNode* existing_paragraph = nullptr;
        if (paragraph.active &&
            paragraph.page_number == line.page_number &&
            paragraph.parent_path == parent_path &&
            gap <= std::max(
                paragraph_gap_limit,
                paragraph.previous_height * 0.75
            )) {
            DocumentNode* paragraph_parent =
                nodeAtPath(result.document, paragraph.parent_path);
            if (paragraph_parent &&
                paragraph.child_index < paragraph_parent->children.size()) {
                existing_paragraph =
                    &paragraph_parent->children[paragraph.child_index];
            }
        }

        if (existing_paragraph) {
            existing_paragraph->text += ' ';
            existing_paragraph->text += line.text;
            existing_paragraph->end_page_number = line.page_number;
            existing_paragraph->end_line_number = line.line_number;
        } else {
            DocumentNode paragraph_node;
            paragraph_node.type = DocumentNodeType::Paragraph;
            paragraph_node.text = line.text;
            paragraph_node.page_number = line.page_number;
            paragraph_node.line_number = line.line_number;
            paragraph_node.end_page_number = line.page_number;
            paragraph_node.end_line_number = line.line_number;

            paragraph.child_index = parent->children.size();
            parent->children.push_back(std::move(paragraph_node));
            paragraph.parent_path = parent_path;
            paragraph.page_number = line.page_number;
            paragraph.active = true;
        }

        paragraph.previous_bottom = line.bottom;
        paragraph.previous_height = line.height;
    }

    result.is_successful = true;
    return result;
}

} // namespace rag
