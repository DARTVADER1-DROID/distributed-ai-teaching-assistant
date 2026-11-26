# PDF Validator

A C++17 validation module for PDF documents. It accepts raw PDF bytes or a
PDF file path, extracts selectable text and font metadata through Poppler, and
runs a configurable validation pipeline.

The current pipeline checks:

1. Minimum and maximum page count.
2. Heading and paragraph/body-text font sizes.
3. Heading-level traversal.

All detected rule violations are collected in a single `ValidationReport`.
The validator is heuristic-based: it checks extracted PDF structure and
typography, but it does not understand document meaning or guarantee that a
visually identified heading is semantically a heading.

## 1. Project structure

```text
validator/
├── config/
│   └── validator_config.hpp
├── extracted_pdf_data.hpp
├── validation_result.hpp
├── page_limit_validator.hpp
├── page_limit_validator.cpp
├── font_size_validator.hpp
├── font_size_validator.cpp
├── heading_level_validator.hpp
├── heading_level_validator.cpp
├── validator_service.hpp
├── validator_service.cpp
├── CMakeLists.txt
└── README.md
```

### Component responsibilities

| Component | Responsibility |
|---|---|
| `ValidatorService` | Owns PDF parsing and extraction, then coordinates the validation stages. |
| `PageLimitValidator` | Checks the PDF page count against configured minimum and maximum values. |
| `FontSizeValidator` | Checks configured heading sizes and paragraph/body-text sizes. |
| `HeadingLevelValidator` | Derives heading levels from font sizes and checks their traversal sequence. |
| `ValidatorConfig` | Holds runtime-tunable validation rules and tolerances. |
| `ExtractedPdfData` | Holds the page count, extracted lines, font sizes, frequency data, and detected body-font baseline. |
| `ValidationReport` | Aggregates configuration errors and document rule violations. |

PDF parsing and extraction intentionally remain inside `ValidatorService`.
The extracted-data structure is only a data-transfer model; it is not another
service.

## 2. Validation pipeline

```text
                    Raw PDF bytes
                          |
                          v
                  ValidatorService
                          |
                          v
                  Parse PDF with Poppler
                          |
                          v
                   ExtractPdfData
                 /                 \\
                /                   \\
       page count and          text lines and
       font metadata           font-size data
             |                       |
             v                       v
      PageLimitValidator       FontSizeValidator
                                      |
                                      v
                              HeadingLevelValidator
                                      |
                 +--------------------+
                 |
                 v
           ValidationReport
```

The service performs extraction once and shares the resulting
`ExtractedPdfData` with the validators.

### Execution behavior

1. The service checks the input bytes and attempts to load the PDF.
2. Once Poppler has loaded a document, the service records its page count.
3. The service extracts selectable text and font-size metadata page by page.
4. The page-limit validator checks the known page count.
5. The font-size validator checks heading candidates and paragraph/body-text
   candidates.
6. If the font-size validator's configuration is valid, the heading-level
   validator checks the heading sequence.
7. The service returns the combined report.

Page-count validation is also attempted when Poppler successfully loads a PDF
but text/font extraction subsequently fails (for example, a scanned PDF).
The extraction failure is still reported. If the PDF cannot be loaded, its
page count is unavailable and page-limit validation cannot run.

Document violations do not stop the remaining independent validation stages.
An invalid page count does not prevent font-size or heading checks from running.
A configuration error in the font-size validator prevents heading traversal
because heading traversal depends on the same heading-size configuration.

## 3. Configuration

Validator settings are configured through `rag::ValidatorConfig` in
`validator/config/validator_config.hpp`. Typography rules are defined once in
`rag::DocumentFormatConfig` at `config/document_format_config.hpp` and are
inherited by `ValidatorConfig`. The extractor will consume this same shared
typography configuration, so heading and paragraph font-size rules cannot
drift between validation and extraction.

### Default values

| Setting | Default | Description |
|---|---:|---|
| `heading_font_sizes` | H1=24, H2=20, H3=18, H4=16, H5=14, H6=12 pt | Expected font size for each heading level. |
| `heading_font_size_tolerance_points` | 0.5 pt | Maximum difference from a configured heading size. |
| `body_font_size_tolerance_points` | 0.5 pt | Difference above the body baseline required for a line to be considered a heading candidate. |
| `paragraph_font_size_tolerance_points` | 0.5 pt | Maximum allowed difference between paragraph/body text and the detected body baseline. |
| `minimum_pages` | 1 | Minimum number of pages required. |
| `maximum_pages` | 0 | Maximum number of pages; zero disables the upper limit. |
| `font_size_precision_decimal_places` | 2 | Decimal places used when normalizing extracted font sizes; valid range is 0–6. |

### Example configuration

```cpp
#include "validator_service.hpp"

rag::ValidatorConfig config;

// Expected heading sizes, in PDF points.
config.heading_font_sizes = {
    {1, 26.0},
    {2, 21.0},
    {3, 17.0}
};

// Typography tolerances, in PDF points.
config.heading_font_size_tolerance_points = 0.75;
config.body_font_size_tolerance_points = 0.4;
config.paragraph_font_size_tolerance_points = 0.5;

// Document length.
config.minimum_pages = 5;
config.maximum_pages = 100;

// Font-size normalization.
config.font_size_precision_decimal_places = 2;

rag::ValidatorService validator(config);
```

The shared `DocumentFormatConfig` owns the heading-size map and typography
tolerances. Both the validator and extractor use these same values. The
heading-size map may contain only the levels required by a particular
document policy. Configured heading levels must be in the H1–H6 range, and
configured sizes must be finite and greater than zero.

## 4. Page-limit validation

### Purpose

`PageLimitValidator` checks the total number of pages in the PDF. It does not
inspect text content and does not need paragraph or heading extraction.

### Rules

- The page count must be greater than or equal to `minimum_pages`.
- If `maximum_pages` is greater than zero, the page count must be less than
  or equal to `maximum_pages`.
- A `maximum_pages` value of zero means that no upper limit is enforced.
- The maximum must be zero or greater than or equal to the minimum.

The limits are inclusive. For example, with a minimum of 5 and maximum of 20,
PDFs containing 5 or 20 pages pass the page-count rule.

### Configuration examples

Minimum only:

```cpp
config.minimum_pages = 5;
config.maximum_pages = 0; // No maximum.
```

Minimum and maximum:

```cpp
config.minimum_pages = 5;
config.maximum_pages = 20;
```

Maximum only, while retaining the default minimum of one page:

```cpp
config.minimum_pages = 1;
config.maximum_pages = 20;
```

Invalid configuration:

```cpp
config.minimum_pages = 20;
config.maximum_pages = 10; // Invalid: maximum is below minimum.
```

An invalid page-limit configuration is reported with
`configuration_valid = false`. The page-limit validator does not silently
swap the values or choose a replacement.

### Page-limit issue examples

For a PDF with 3 pages and a minimum of 5:

```text
PDF contains 3 pages; the minimum required is 5.
```

For a PDF with 25 pages and a maximum of 20:

```text
PDF contains 25 pages; the maximum allowed is 20.
```

Page-count issues do not currently include a line number or line text because
they apply to the document as a whole.

## 5. Font-size validation

`FontSizeValidator` performs two related checks using the extracted font-size
data.

### 5.1 Body-font baseline

The extraction stage counts occurrences of each valid font size across the
PDF. The most frequently occurring font size is selected as
`ExtractedPdfData::body_font_size`.

This is a heuristic baseline. It is not supplied by PDF semantics and may not
be the actual body size in documents with unusual typography or a large number
of tables, captions, footnotes, or headings.

### 5.2 Heading font sizes

A line is considered a heading candidate when at least one of its extracted
font sizes is greater than:

```text
body_font_size + body_font_size_tolerance_points
```

Each distinct font size above that threshold is compared with the configured
H1–H6 sizes. A match is accepted when its absolute difference from the nearest
configured size is within `heading_font_size_tolerance_points`.

The validator reports:

- A non-body font size that does not match any configured heading size.
- A configured heading level that is detected with inconsistent sizes.

Repeated word-level text boxes with the same size on one visual line are
deduplicated before checking, preventing one issue per word for the same
line-level rule break.

A heading candidate line is excluded from paragraph/body-text validation as
a whole. This avoids treating the body-sized words in a heading line as
paragraph text.

### 5.3 Paragraph/body-text font sizes

A line that is not identified as a heading candidate is treated as a
paragraph/body-text candidate.

Each distinct font size on that line is compared with the detected body-font
baseline. The line is reported when the absolute difference exceeds
`paragraph_font_size_tolerance_points`.

For example, if the detected body size is 11 pt and paragraph tolerance is
0.5 pt:

| Extracted paragraph size | Result |
|---:|---|
| 11.0 pt | Pass |
| 11.4 pt | Pass |
| 11.5 pt | Pass |
| 11.6 pt | Violation |
| 10.0 pt | Violation |

This check is a typography consistency heuristic, not semantic paragraph
recognition. Captions, footnotes, list items, table text, and other non-heading
lines may be treated as paragraph candidates. Inline styling and mixed-size
lines may also affect classification.

### 5.4 No heading candidates

If no heading sizes are identified and no earlier issue has already been
reported, the font-size validator reports that no heading font sizes could be
identified. A document whose headings use the same size as body text cannot
be reliably identified as having headings by this font-size heuristic alone.

## 6. Heading-level traversal

`HeadingLevelValidator` independently derives a level for each line that
matches a configured heading size and is above the body-font threshold.

The current traversal rule allows adjacent detected headings to:

- Remain at the same level.
- Move down exactly one level, such as H1 to H2.
- Move up exactly one level, such as H2 to H1.

A transition that skips a level is reported. For example:

| Transition | Result |
|---|---|
| H1 → H1 | Pass |
| H1 → H2 | Pass |
| H2 → H1 | Pass |
| H2 → H3 | Pass |
| H1 → H3 | Violation |
| H3 → H1 | Violation |

The validator checks the sequence of detected headings in extracted line order.
It does not currently construct a semantic document tree or assign paragraphs
to their parent headings. That structure can be built by a later document
structuring/ingestion stage.

## 7. Validation report

Both public service methods return `rag::ValidationReport`:

```cpp
struct ValidationReport {
    std::vector<ValidationIssue> issues;
    bool configuration_valid = true;

    bool isValid() const noexcept;
    void addIssue(ValidationIssue issue);
    void append(const ValidationReport& other);
};
```

### ValidationIssue fields

| Field | Meaning |
|---|---|
| `reason` | Human-readable explanation of the rule violation. |
| `page_number` | One-based PDF page number; zero when not applicable or unavailable. |
| `line_number` | One-based inferred visual line number; zero when not applicable or unavailable. |
| `word_count` | Whitespace-delimited word count for the extracted line. |
| `line_text` | Extracted text for the line associated with the issue. |

Page-level issues normally have page and line numbers set to zero. Extraction
errors may provide a page number when a particular page could not be read.

### Report semantics

- `report.isValid()` returns true only when `issues` is empty.
- `configuration_valid` indicates whether the configuration checks performed
  by the validators were valid.
- `append()` adds every issue from another report and combines configuration
  validity using logical AND.
- Multiple independent document violations can appear in the same report.

A report with issues does not necessarily mean the PDF could not be parsed.
It may mean the PDF was parsed successfully but violated one or more configured
rules.

## 8. Public API and usage

### Validate raw PDF bytes

This is suitable when a PDF is received from an HTTP upload or another
in-memory source.

```cpp
#include "validator_service.hpp"

#include <cstdint>
#include <iostream>
#include <vector>

int main() {
    rag::ValidatorConfig config;
    config.minimum_pages = 2;
    config.maximum_pages = 30;

    rag::ValidatorService validator(config);

    std::vector<std::uint8_t> pdf_bytes = /* uploaded PDF bytes */;

    const rag::ValidationReport report = validator.validatePdf(pdf_bytes);

    if (report.isValid()) {
        std::cout << "PDF passed validation.\n";
        return 0;
    }

    for (const auto& issue : report.issues) {
        std::cout << issue.reason << '\n';

        if (issue.page_number != 0) {
            std::cout << "Page: " << issue.page_number << '\n';
        }
        if (issue.line_number != 0) {
            std::cout << "Line: " << issue.line_number << '\n';
        }
        if (!issue.line_text.empty()) {
            std::cout << "Text: " << issue.line_text << '\n';
        }
    }

    return 1;
}
```

### Validate a PDF file from disk

```cpp
const rag::ValidationReport report =
    validator.validatePdfFile("document.pdf");
```

The file method reads the file as binary bytes and delegates to
`validatePdf()`. It reports errors for an empty path, an inaccessible file,
or a read failure.

## 9. PDF extraction behavior

The service uses Poppler's C++ API to load the document and read each page's
text list with font information enabled.

For each extracted text box, the service:

1. Reads its UTF-8 text.
2. Reads its bounding box.
3. Groups nearby text boxes into inferred visual lines using their vertical
   centers and heights.
4. Appends the text to the inferred line.
5. Records valid font sizes after rounding to the configured decimal precision.
6. Updates the document-wide font-size frequency map.

The resulting `ExtractedPdfData` includes:

| Field | Description |
|---|---|
| `page_count` | Total pages reported by Poppler. |
| `lines` | Extracted visual lines with page, line, text, word count, and font sizes. |
| `ordered_font_sizes` | Font sizes in extraction order. |
| `font_size_frequency` | Number of occurrences of each normalized font size. |
| `body_font_size` | Most frequently occurring extracted font size. |

Page numbers and line numbers are one-based.

## 10. Error handling and unsupported PDFs

The extraction stage reports failures for cases including:

- Empty PDF byte input.
- Input too large for the current Poppler raw-data API call.
- Invalid or unparseable PDF data.
- Encrypted or password-protected PDFs.
- PDFs with no pages.
- Failure to create/read a PDF page.
- PDFs with no extractable text carrying font metadata.

### Scanned PDFs and images

The current implementation does not perform OCR. A scanned PDF containing only
page images, or a PDF whose text has been converted to vector outlines, may
not provide extractable text/font metadata. Such a document cannot pass the
current font-size validation pipeline.

Page limits may still be checked if Poppler successfully loads the PDF and
reports its page count before text extraction fails.

### Layout limitations

PDFs do not expose a universal semantic paragraph or line structure through
the extraction API used here. The current line grouping is inferred from text
box geometry. Complex scripts, unusual writing directions, tables, and
multi-column layouts may require more advanced reading-order and layout
analysis.

The service processes text boxes in Poppler's returned order. That order may
not always correspond to the intended human reading order in a multi-column
document.

## 11. Build requirements

### Dependencies

- C++17-compatible compiler.
- CMake 3.16 or newer.
- pkg-config.
- Poppler C++ development library, version 0.89 or newer.
- Poppler development package.

### Debian/Ubuntu

```bash
sudo apt-get update
sudo apt-get install cmake pkg-config libpoppler-cpp-dev
```

### Configure and build

Run these commands from the validator directory:

```bash
cmake -S . -B build
cmake --build build
```

The CMake target is `rag_validator`. It compiles:

- `validator_service.cpp`
- `page_limit_validator.cpp`
- `font_size_validator.cpp`
- `heading_level_validator.cpp`

## 12. Current scope and future extensions

The validator currently enforces page-count limits, font-size consistency
heuristics, and heading-level traversal. It does not currently:

- Perform OCR on scanned PDFs.
- Validate font family, font weight, margins, spacing, or page dimensions.
- Reliably distinguish paragraphs from captions, footnotes, tables, or lists.
- Identify headings using semantic meaning or PDF bookmarks.
- Build a nested heading/paragraph tree.
- Assign paragraph chunks to their nearest preceding heading.
- Guarantee correct reading order for complex multi-column layouts.

A later document-structure stage can use extracted headings and reading order
to construct a hierarchy and associate body content with the nearest preceding
heading. That structure can then be used as metadata during RAG chunking and
vector-database ingestion.



## 13. C++ library package

The validator is maintained as a reusable C++ library. It does not contain a
standalone command-line entry point. Applications should create their own
entry point and call the public `ValidatorService` API.

The repository includes a GitHub Actions workflow at
`.github/workflows/validator-windows.yml`. It builds the library on a
temporary Windows runner and uploads a package containing the compiled static
library and public headers.

The workflow runs automatically when files under `rag-server/validator/`
or the workflow itself are pushed, and on matching pull requests. It can also
be started manually from the **Actions** tab using **Run workflow**.

### Download the Windows library

1. Open the repository's **Actions** tab.
2. Select **Build PDF Validator (Windows)**.
3. Open the latest successful run.
4. Download the `validator-windows-x64-library` artifact.

The package contains:

```text
output/
├── include/
│   └── validator/
│       ├── *.hpp
│       └── config/
│           └── *.hpp
├── lib/
│   └── librag_validator.a
└── README-LIBRARY.txt
```

The static library must be linked into a C++ application together with its
Poppler C++ and Poppler dependencies. It is not a standalone executable.

The cloud runner's output directory is temporary and is uploaded as a workflow
artifact; compiled binaries are deliberately not committed to the source
repository. Artifacts are retained for 14 days, so download a build you want
to keep.
