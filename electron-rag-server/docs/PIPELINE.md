# PDF Ingestion and Retrieval Pipelines

## 1. Ingestion overview

A course upload is processed in this order:

1. Create course identity and run duplicate checks.
2. Parse the PDF once with PDF.js.
3. Convert parser output to validator input and run all validation stages.
4. Reuse the parsed document to build a hierarchical extraction tree.
5. Load the pinned BGE-M3 tokenizer when first needed.
6. Convert paragraphs into chunks that fit the configured token budget.
7. Load the local BGE-M3 ONNX embedding model when first needed.
8. Embed every chunk's heading-aware embedding text.
9. Return the completed pipeline result to the persistence layer.

A failure at any processing stage prevents the course from being published. The pipeline identifies the failing stage as identity, PDF parsing, validation, extraction, chunking or embedding.

## 2. Course identity and duplicate checks

The uploaded filename is normalized to its basename, trimmed and Unicode NFC-normalized. A lower-case key is used for case-insensitive filename uniqueness. The original display filename is retained without client-supplied directory components.

The exact uploaded bytes are fingerprinted with SHA-256. A create is rejected if either the normalized filename or exact-byte hash already exists in the course catalogue.

This is byte-level duplicate detection. Two visually identical PDFs exported with different metadata or internal object ordering can have different hashes and are not guaranteed to be detected as duplicates.

For replacement, the existing course ID is excluded from duplicate checks. If both normalized filename and exact-byte hash match the existing course, the update is rejected as a no-op before the expensive PDF/model pipeline starts.

## 3. PDF parsing

The production adapter is `PdfJsDocumentParser`.

It extracts text items page by page and maps them into text boxes containing:

- Text content.
- Top and bottom coordinates normalized to a top-left page origin.
- Height.
- Font size recovered from the PDF.js text transform.
- PDF.js line-ending hint.

The parser preserves page order. The validator adapter groups text boxes into lines and records page number, line number, combined text, word count and font sizes.

The parser is invoked once per ingestion. Its parsed document is reused by validation and hierarchy extraction; the pipeline does not need to decode the PDF a second time for extraction.

## 4. Validation

Validation runs before hierarchy extraction. It includes:

- Page-count limits.
- Heading/body font-size validation.
- Heading hierarchy and explicit closure validation.

The default page range is at least one page with no configured maximum. The default heading scale and closure syntax are documented in [VALIDATOR-GUIDE.md](../VALIDATOR-GUIDE.md).

A rejected PDF returns validation issues with page and line information where available. Fix the PDF formatting rather than bypassing validation: downstream hierarchy extraction depends on consistent font and layout signals.

## 5. Hierarchical extraction

The extractor converts the parsed pages into a tree of:

- `Document` root nodes.
- `Heading` nodes with levels H1-H6.
- `Paragraph` nodes.

Each node carries source page/line information and an end range. Heading nodes contain their nested child headings and paragraphs. The extractor uses configured heading font sizes and text-line geometry to identify headings and associate paragraph content with the active hierarchy.

Page-span metadata is finalized after the hierarchy is built so a heading's end range includes its descendants. The root's `page_count` represents the full parsed document.

The extraction tree is returned by course retrieval and is serialized in the course catalogue.

## 6. Chunking

The chunker traverses the extraction tree in document order.

- Paragraphs in the same contiguous group under a heading context are combined while they fit.
- Heading nodes extend the heading path for their descendants.
- A chunk's `text` contains source paragraph content.
- A chunk's `embedding_text` prepends the heading path joined by ` > `, followed by a newline and the source content.
- The heading path is also stored separately as metadata.
- Chunk indices are zero-based and follow output order.
- Source page/line ranges are retained.

The default `max_chunk_tokens` is 512. The token count is calculated against the complete `embedding_text`, including heading context and tokenizer special tokens—not just the paragraph body.

If a paragraph is too large, it is split at the largest fitting Unicode-safe prefix. The splitter prefers sentence boundaries, then clause boundaries, then whitespace, and finally the best fitting character boundary. It does not split a UTF-16 surrogate pair. If a single tokenizer unit cannot fit, chunking fails rather than silently exceeding the limit.

The chunker requires an injected token counter. The production pipeline supplies the pinned BGE-M3 tokenizer.

## 7. Embedding

The tokenizer and ONNX model use the same configured Hugging Face repository and immutable revision by default:

- Repository: `onnx-community/bge-m3-ONNX`
- Revision: `25b9af8e87a38eb120cfe87125383677b9cd309e`
- Dimensions: 1024
- Maximum model sequence length declared by the embedding service: 8192
- Pooling: CLS
- Normalization: enabled
- Default embedding batch size: 8

Model loaders use local files only. They do not download model files during startup or inference. The chunk limit of 512 is a separate application configuration and is the effective limit applied by the chunker.

The pipeline verifies that the embedding output count matches the chunk count, each vector has 1024 finite values, and the returned dimension is 1024.

## 8. Persistence

After all processing succeeds, the repository assigns a generation UUID and writes chunk rows with:

- Course ID and generation ID.
- Chunk ID and zero-based chunk index.
- Vector and embedding model metadata.
- Original content and heading-aware embedding text.
- Heading path, token count and source page/line range.

For a new course, chunk rows are written before the course catalogue record is published. If catalogue insertion fails, the repository attempts to delete the just-written chunk generation.

For a replacement, a new generation is written before the catalogue switches to it. The prior generation is deleted after the switch. See [DATA-MODEL.md](./DATA-MODEL.md).

## 9. Retrieval

The retrieval endpoint:

1. Validates the query, optional course UUID and `top_k`.
2. Trims the query and embeds it with the same configured embedding service.
3. Verifies that exactly one finite 1024-dimensional vector was returned.
4. Reads the course catalogue to determine active course generations.
5. Searches LanceDB using cosine distance, restricted to active generations and the same embedding model ID.
6. Returns the nearest chunks with content, heading path, source range and distance.

Default `top_k` is 5; valid values are integers from 1 through 50. Query length must be between 1 and 8000 characters after the non-empty check. If `course_id` is omitted, the search spans all courses. If a requested course ID is unknown, the endpoint returns not found. A valid search with no matches returns an empty results array.

Cosine distance is a distance measure: lower values indicate closer vectors. It is not a probability or a calibrated confidence score.
