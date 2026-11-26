# Extractor

The extractor module is responsible for extracting structured content and metadata from source documents for downstream RAG processing.

## Shared document configuration

Typography rules are defined centrally in
`rag-server/config/document_format_config.hpp` as
`rag::DocumentFormatConfig`.

The validator uses this configuration when checking heading and paragraph
font sizes. The extractor will use the same configuration when interpreting
the approved document's typography and reconstructing its heading hierarchy.
The extractor must not introduce a separate set of heading-size rules.

The shared configuration currently defines:

- Expected font size for each configured heading level (H1–H6 by default).
- Heading font-size matching tolerance.
- Minimum size difference used to distinguish heading candidates from body text.
- Paragraph/body-text font-size tolerance.
- Font-size normalization precision.

These values are expressed in PDF points where applicable. The defaults and
runtime overrides are owned by the shared configuration, not by the extractor.

## Scope

- Accept source documents through the extractor interface.
- Extract document content and structural metadata.
- Preserve source locations such as page numbers and text positions where available.
- Return structured extraction results for subsequent processing.

PDF extraction and hierarchy construction are not implemented yet. Their
interfaces and data contracts will be defined after the shared configuration
has been reviewed.
