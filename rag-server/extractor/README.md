# Extractor

The extractor module reconstructs a navigable document hierarchy from validated PDF documents.

## Public API

`ExtractorService` accepts the shared `DocumentFormatConfig` and exposes:

```cpp
ExtractionResult extractPdf(
    const std::vector<std::uint8_t>& pdf_data
) const;
```

The input is the raw byte content of a PDF. The caller is responsible for
passing a document that has already passed `ValidatorService`. The extractor
does not run validation again.

## Returned structure

The result contains:

- `is_successful` and `error` for operation status.
- A recursive `DocumentNode` tree.
- Node types: `Document`, `Heading`, and `Paragraph`.
- A `heading_level` value for heading nodes.
- One-based page and visual-line positions, including the end position of
  paragraph nodes.
- A `children` collection for arbitrary-depth nesting.

The hierarchy is dynamic. It does not contain fixed H1/H2/H3 fields or empty
placeholder nodes for levels that do not occur in the document.

Conceptual example:

```text
Document
└── Heading (level 1): Heading 1
    └── Heading (level 2): Sub heading 2
        └── Heading (level 3): Sub sub heading 1
            └── Paragraph: Paragraph 2
```

A paragraph is attached to the deepest heading currently in scope. A new
heading becomes a child of the nearest preceding heading with a lower level.
Headings at the same or a higher level close the previous heading's scope.
Consecutive body-text lines are joined into paragraph nodes when their page
and vertical spacing indicate that they belong together.

## Typography and heading detection

The extractor consumes `rag::DocumentFormatConfig` from
`rag-server/config/document_format_config.hpp`. Heading sizes, heading-size
tolerance, body-size threshold, and font-size precision are not duplicated in
the extractor.

The most frequently occurring normalized font size is used as the body-font
baseline, matching the validator's current approach. A line is treated as a
heading when its font size matches a configured heading size within the shared
tolerance and is sufficiently larger than the body baseline.

The extractor trusts the caller's validation result; it does not independently
verify that the document passed validation.

## Limitations

- Text extraction uses Poppler and PDF text/font metadata.
- Scanned pages, outlined text, and documents without extractable font metadata
  are not OCR-processed and return an extraction error.
- Paragraph grouping is inferred from PDF line positions and vertical spacing;
  PDF layout does not provide a universal semantic paragraph boundary.
- The current result is a native C++ tree. It can be serialized to JSON by a
  later API layer without adding a JSON dependency to this library.

## Build

Build as a C++17 static library:

```sh
cmake -S rag-server/extractor -B rag-server/extractor/build
cmake --build rag-server/extractor/build
```

Poppler C++ and Poppler development libraries are required.
