#pragma once

#include "config/validator_config.hpp"
#include "validation_result.hpp"

#include <cstddef>

namespace rag {

class PageLimitValidator {
public:
    explicit PageLimitValidator(ValidatorConfig config = {});

    ValidationReport validate(std::size_t page_count) const;

private:
    ValidatorConfig config_;
};

} // namespace rag
