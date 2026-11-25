# PDF Heading Validator

A small C++17 service that checks PDF heading font sizes against the configured
heading scale.

## Default heading sizes

| Level | Default size |
| --- | ---: |
| H1 | 24 pt |
| H2 | 20 pt |
| H3 | 18 pt |
| H4 | 16 pt |
| H5 | 14 pt |
| H6 | 12 pt |

The accepted deviation is +/- 0.5 pt.

## Configuration

All validator tuning values live in `config/validator_config.hpp` as a
`rag::ValidatorConfig` struct. Defaults are provided, but callers can override
any setting at construction time:

```cpp
#include "validator_service.hpp"

rag::ValidatorConfig config;
config.heading_font_sizes = {
    {1, 26.0},
    {2, 21.0},
    {3, 17.0}
};
config.heading_font_size_tolerance_points = 0.75;
config.body_font_size_tolerance_points = 0.4;
config.font_size_precision_decimal_places = 2;

rag::ValidatorService validator(config);
```

Invalid configuration values are rejected with a reason before PDF validation.
Missing heading levels are allowed. The configuration object is copied into the
service, so each service instance has its own settings.

## Configuration

All validator tuning values live in `config/validator_config.hpp` as a
`rag::ValidatorConfig` struct. Defaults are provided, but callers can override
any setting at construction time:

```cpp
#include "validator_service.hpp"

rag::ValidatorConfig config;
config.heading_font_sizes = {
    {1, 26.0},
    {2, 21.0},
    {3, 17.0}
};
config.heading_font_size_tolerance_points = 0.75;
config.body_font_size_tolerance_points = 0.4;
config.font_size_precision_decimal_places = 2;

rag::ValidatorService validator(config);
```

Invalid configuration values are rejected with a reason before PDF validation.
Missing heading levels are allowed. The configuration object is copied into the
service, so each service instance has its own settings.

## Dependency

The PDF parser is Poppler's C++ library (version 0.89 or newer).

On Debian/Ubuntu:

```bash
sudo apt-get install cmake pkg-config libpoppler-cpp-dev
```

## Build

Run from this directory:

```bash
cmake -S . -B build
cmake --build build
```

This builds the `rag_validator` library.

## Usage

Pass uploaded PDF bytes directly:

```cpp
#include "validator_service.hpp"

rag::ValidatorService validator;
std::vector<std::uint8_t> pdf_bytes = /* uploaded PDF bytes */;

const rag::ValidationResult result = validator.validatePdf(pdf_bytes);
if (!result.is_valid) {
    // Report result.reason to the caller.
}
```

Or validate a PDF stored on disk:

```cpp
const rag::ValidationResult result =
    validator.validatePdfFile("document.pdf");
```

The existing `hasConsistentHeadingFontSizes` method remains available when
another component has already extracted a map of heading levels to font sizes.

## Current extraction behavior and limitations

Poppler extracts text words and their font sizes. The current first-pass
heuristic treats the most frequently occurring font size as body text and
larger font sizes as heading candidates. Each candidate must match one of the
configured H1-H6 sizes within the tolerance.

This is not semantic heading recognition: PDFs without tagged headings can be
ambiguous, and large non-heading text (for example, figure titles) may be
treated as a heading candidate. A heading that uses the same size as body text
cannot be distinguished by font size alone. Scanned PDFs or PDFs containing
only outlined text do not expose extractable font metadata and are rejected
with an explanatory reason.

A later iteration can improve heading identification using line layout,
boldness, numbering patterns, and PDF structure tags where available.
