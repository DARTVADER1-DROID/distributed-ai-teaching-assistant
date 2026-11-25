#pragma once

#include <cstddef>
#include <string>
#include <utility>
#include <vector>

namespace rag {

// One individual rule violation.
struct ValidationIssue {
    std::string reason;

    // One-based PDF page and inferred visual line. Zero means unavailable.
    std::size_t page_number = 0;
    std::size_t line_number = 0;
    std::size_t word_count = 0;
    std::string line_text;
};

// Complete outcome returned by validators and ValidatorService.
struct ValidationReport {
    std::vector<ValidationIssue> issues;
    bool configuration_valid = true;

    bool isValid() const noexcept {
        return issues.empty();
    }

    void addIssue(ValidationIssue issue) {
        issues.push_back(std::move(issue));
    }

    void append(const ValidationReport& other) {
        issues.insert(issues.end(), other.issues.begin(), other.issues.end());
        configuration_valid = configuration_valid && other.configuration_valid;
    }
};

// Status used by the low-level PDF extraction operation.
struct ValidationResult {
    bool is_valid = false;
    std::string reason;
    std::size_t page_number = 0;
};

} // namespace rag
