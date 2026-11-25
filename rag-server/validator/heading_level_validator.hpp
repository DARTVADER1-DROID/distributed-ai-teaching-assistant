#pragma once

#include "validation_result.hpp"

#include <vector>

namespace rag {

class HeadingLevelValidator {
public:
    ValidationResult validate(
        const std::vector<int>& heading_levels
    ) const;
};

} // namespace rag
