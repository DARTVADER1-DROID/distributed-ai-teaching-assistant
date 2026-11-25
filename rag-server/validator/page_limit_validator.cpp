#include "page_limit_validator.hpp"

#include <string>
#include <utility>

namespace rag {

PageLimitValidator::PageLimitValidator(ValidatorConfig config)
    : config_(std::move(config)) {}

ValidationReport PageLimitValidator::validate(std::size_t page_count) const {
    ValidationReport report;

    if (config_.maximum_pages != 0 &&
        config_.maximum_pages < config_.minimum_pages) {
        report.configuration_valid = false;
        report.addIssue({
            "Invalid page-limit configuration: maximum_pages must be zero "
            "or greater than or equal to minimum_pages."
        });
        return report;
    }

    if (page_count < config_.minimum_pages) {
        report.addIssue({
            "PDF contains " + std::to_string(page_count) +
            " pages; the minimum required is " +
            std::to_string(config_.minimum_pages) + "."
        });
    }

    if (config_.maximum_pages != 0 &&
        page_count > config_.maximum_pages) {
        report.addIssue({
            "PDF contains " + std::to_string(page_count) +
            " pages; the maximum allowed is " +
            std::to_string(config_.maximum_pages) + "."
        });
    }

    return report;
}

} // namespace rag
