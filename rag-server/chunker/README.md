# Chunker

The chunker converts a successful `ExtractionResult` into ordered, embedding-ready text chunks.

## Responsibilities

- Traverse the extracted hierarchy in document order.
- Keep content from unrelated heading sections separate.
- Group consecutive paragraphs belonging to the same parent section.
- Keep a paragraph intact when it fits within the configured token limit.
- Split oversized paragraphs at sentence boundaries where possible, then clause punctuation, whitespace, and finally UTF-8-safe character boundaries.
- Preserve every source character; no overlap or content deduplication is applied.
- Attach the complete heading path and source page/line range to every chunk.
- Produce both original content and heading-enriched embedding input.

## Configuration

The token limit is defined in `rag-server/config/chunker_config.hpp`:

- `ChunkerConfig::max_chunk_tokens`: maximum token count for the complete embedding input, including the heading path.
- Initial default: 512 tokens. This is a benchmark baseline, not a permanently fixed model requirement.

The chunker does not estimate token counts. It requires a `TokenCounter` callback supplied by the caller. That callback must count using the exact tokenizer associated with the selected embedding model. This keeps the chunker independent of BGE-M3 and allows another embedding model to be selected later.

## Input and output

Input:

- A successful `ExtractionResult` from `ExtractorService`.

Each `DocumentChunk` contains:

- `index`: zero-based order in the output.
- `text`: original extracted content, without synthetic heading prefixes.
- `embedding_text`: heading path followed by the original content; send this field to the embedding model.
- `heading_path`: ordered heading titles from H1 to the current section.
- Source page and visual line ranges.

## Chunk formation

- Paragraphs are grouped only when they are consecutive children of the same document/heading node.
- A child heading ends the current paragraph group and is processed independently.
- Heading context is included in token counting, so a long heading path cannot silently push an embedding input over the configured limit.
- The first chunk of a paragraph group may contain multiple paragraphs separated by two newline characters.
- Oversized paragraphs are split without overlap. Adjacent fragments are not duplicated or discarded.
- Empty paragraphs do not produce chunks.
- A document with no paragraph content succeeds with an empty chunk collection.

## Current boundaries

The extractor currently represents document, heading, and paragraph nodes. Tables, equations, images, and diagram-specific chunking are not implemented here. Those need explicit extractor content types and separately agreed rules.

The service does not modify the extractor or validator.
