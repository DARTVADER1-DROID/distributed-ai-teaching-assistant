# PDF Heading Validator

A small C++17 service that extracts PDF font metadata once and runs independent
heading validators against the shared extracted data.

## Default heading sizes

| Level | Default size |
| --- | ---: |
| H1 | 24 pt |
| H2 | 20 pt |
| H3 | 18 pt |
| H4 | 16 pt |
| H5 | 14 pt |
| H6 | 12 pt |

The accepted font-size deviation is +/- 0.5 pt.

## Responsibilities

- `PdfFontSizeExtractor`: parses the PDF once and returns `ExtractedPdfData`,
  containing ordered font sizes, font-size frequencies, and the most frequent
  font size used as the body-text baseline.
- `FontSizeValidator`: receives `ExtractedPdfData` and validates heading
  candidates against the configured font-size scale.
- `HeadingLevelValidator`: receives the same `ExtractedPdfData`, derives the
  heading-level sequence, and checks its traversal.
- `ValidatorService`: coordinates extraction and validation only. It does not
  parse PDF internals or implement either validation rule.

## Validation flow

```text
PDF bytes
   |
   v
PdfFontSizeExtractor
   |
   | ExtractedPdfData (one extraction)
   v
FontSizeValidator
   |
   | valid
   v
HeadingLevelValidator
   |
   v
ValidationResult
```

The service stops and returns the first failure. Both validators receive the
same extracted data; the PDF is not parsed a second time.

## Configuration

All tuning values live in `config/validator_config.hpp` as
`rag::ValidatorConfig`. Defaults can be overridden at construction time:

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

## Heading-level traversal rule

Adjacent headings may stay at the same level or move exactly one level up or
down. For example, H1 -> H2 and H2 -> H1 are valid; H1 -> H3 is invalid.
Heading levels must be in the H1-H6 range.

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
const auto result = validator.validatePdfFile("document.pdf");
```

## Dependency and build

The PDF parser is Poppler's C++ library (version 0.89 or newer).

On Debian/Ubuntu:

```bash
sudo apt-get install cmake pkg-config libpoppler-cpp-dev
cmake -S . -B build
cmake --build build
```

## Extraction limitations

Poppler supplies text boxes and font sizes, not guaranteed semantic headings.
The current heuristic treats the most frequent font size as body text and
larger sizes matching the configured scale as heading candidates. Large
non-heading text (such as figure titles) may be misclassified, and a heading
that uses the body font size cannot be distinguished by size alone. Scanned
PDFs or PDFs containing only outlined text have no extractable font metadata
and are rejected.

Text boxes are processed in Poppler's returned order; complex multi-column
layouts may not correspond to a reader's intended document order.
