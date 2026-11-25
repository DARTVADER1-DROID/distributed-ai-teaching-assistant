# PDF Heading and Paragraph Font Validator

A small C++17 service that accepts raw PDF bytes, extracts selectable text and
font metadata, and validates heading and paragraph font sizes plus heading
hierarchy. Every detected rule violation is collected into one report.

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

- `ValidatorService`: owns PDF parsing and extraction. It creates the shared
  `ExtractedPdfData` and coordinates the validators.
- `FontSizeValidator`: validates heading candidates against the configured
  H1-H6 font-size scale and checks non-heading paragraph/body-text lines against
  the detected body-font baseline.
- `HeadingLevelValidator`: derives the heading-level sequence and checks
  its traversal.
- `PageLimitValidator`: checks the extracted PDF page count against configured
  minimum and maximum limits.
- `ExtractedPdfData`: a data structure containing extracted lines, font
  sizes, frequency information, and the detected body-text baseline.
- `ValidationReport`: aggregates all detected rule violations.

The extraction data model is a plain data structure, not a separate service.

## Image handling

This validator does not extract, OCR, classify, or validate embedded images.
It extracts selectable PDF text and its font metadata. A PDF containing only
scanned page images or outlined text cannot currently be validated because
there is no extractable text/font metadata.

## Validation flow

```text
Raw PDF bytes
     |
     v
ValidatorService
     |
     | Parse PDF and extract text/font metadata
     v
ExtractedPdfData
     |
     +----------------------+
     v                      v
FontSizeValidator    HeadingLevelValidator
     |                      |
     +----------+-----------+
                |
                v
        PageLimitValidator
                v
        ValidationReport
```

The service extracts the PDF once and passes the same extracted data to both
validators. It runs both validators even if the font-size validator finds
document rule violations. If the shared configuration is invalid, it reports
those configuration issues and skips heading traversal, which depends on that
configuration.

## Validation report and error details

`ValidatorService` returns a `ValidationReport`. Its `issues` vector contains
every detected violation from both validators. An empty vector means success;
use `report.isValid()` to check the overall result.

Each `ValidationIssue` contains:

- `reason`: human-readable rule violation.
- `page_number`: one-based PDF page number, or 0 when unavailable.
- `line_number`: one-based extracted line number within that page, or 0 when
  unavailable.
- `line_text`: extracted text for the line that caused the violation.
- `word_count`: whitespace-delimited word count for that extracted line.

The line grouping is inferred from Poppler text-box bounding boxes. PDFs do not
provide a universal semantic line structure, so this is the detected visual
line, not a guarantee of the exact line as rendered by every PDF viewer.
Poppler documents `text_list()` as returning roughly one word per text box;
word counts are therefore most reliable for whitespace-delimited languages.
Complex scripts and multi-column layouts may need language/layout-specific
handling.

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
config.paragraph_font_size_tolerance_points = 0.5;
config.minimum_pages = 1;
config.maximum_pages = 100; // Set to 0 for no maximum.
config.font_size_precision_decimal_places = 2;

rag::ValidatorService validator(config);
```

## Page limits

`minimum_pages` defaults to 1. `maximum_pages` defaults to 0, which disables
an upper limit. Set `maximum_pages` to a positive value to enforce it. A
configuration where the maximum is lower than the minimum is invalid. Page
limit violations are aggregated with font-size and heading-level violations.

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

const rag::ValidationReport report = validator.validatePdf(pdf_bytes);
if (!report.isValid()) {
    for (const auto& issue : report.issues) {
        // Use issue.reason, issue.page_number, issue.line_number,
        // issue.line_text, and issue.word_count.
    }
}
```

Or validate a PDF stored on disk:

```cpp
const rag::ValidationReport report = validator.validatePdfFile("document.pdf");
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
larger sizes as heading candidates. Lines without a larger-than-body font size
are treated as paragraph/body-text candidates and their font sizes are compared
with the detected body baseline using the configured paragraph tolerance.
This is not semantic paragraph detection: captions, footnotes, list items, and
other non-heading text can be treated as paragraph candidates. Large
non-heading text (such as figure titles) may be misclassified, and a heading
that uses the body font size cannot be distinguished by size alone. Scanned
PDFs or PDFs containing only outlined text have no extractable font metadata
and are rejected.

Text boxes are processed in Poppler's returned order; complex multi-column
layouts may not correspond to a reader's intended document order.
