#pragma once

#include <cstddef>
#include <string>

namespace rag {

struct ValidationResult {
    bool is_valid = false;
    std::string reason;

    // One-based PDF page and inferred visual line. Zero means unavailable.
    std::size_t page_number = 0;
    std::size_t line_number = 0;
    std::size_t word_count = 0;
    std::string line_text;
};

} // namespace rag
