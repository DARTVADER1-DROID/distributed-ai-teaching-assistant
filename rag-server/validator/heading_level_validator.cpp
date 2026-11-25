#include "heading_level_validator.hpp"

#include <cstdlib>
#include <string>

namespace rag {

ValidationResult HeadingLevelValidator::validate(
    const std::vector<int>& heading_levels
) const {
    if (heading_levels.empty()) {
        return {false, "No heading levels were provided for traversal validation."};
    }

    for (std::size_t index = 0; index < heading_levels.size(); ++index) {
        const int current_level = heading_levels[index];
        if (current_level < 1 || current_level > 6) {
            return {
                false,
                "Invalid heading level at position " + std::to_string(index + 1) +
                    ": H" + std::to_string(current_level) + "; expected H1-H6."
            };
        }

        if (index == 0) {
            continue;
        }

        const int previous_level = heading_levels[index - 1];
        if (std::abs(current_level - previous_level) > 1) {
            return {
                false,
                "Invalid heading level transition at position " +
                    std::to_string(index) + " to " + std::to_string(index + 1) +
                    ": H" + std::to_string(previous_level) + " -> H" +
                    std::to_string(current_level) +
                    ". Heading levels may change by only one level at a time."
            };
        }
    }

    return {true, ""};
}

} // namespace rag
