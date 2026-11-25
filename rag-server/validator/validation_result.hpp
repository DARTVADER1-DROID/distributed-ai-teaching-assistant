#pragma once

#include <string>

namespace rag {

struct ValidationResult {
    bool is_valid;
    std::string reason;
};

} // namespace rag
