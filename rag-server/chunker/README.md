# Chunker

This module converts the hierarchical document tree produced by the extractor into retrieval-ready text chunks.

## Responsibilities

- Preserve document and heading context.
- Group related paragraph content into coherent chunks.
- Split content that exceeds configured size limits without discarding text.
- Preserve source metadata such as document identity, heading path, and page boundaries.
- Produce deterministic output for identical input and configuration.

## Model dependency

The chunker does not require an AI or embedding model. It is a deterministic document-processing component.

Embedding generation is a separate downstream responsibility. The embedding component will convert each completed chunk into a vector using the selected embedding model (currently BGE-M3 is the preferred candidate).

## Input and output

- Input: the hierarchical document tree produced by `ExtractorService`.
- Output: an ordered collection of chunks containing text and source metadata, suitable for embedding and storage in the vector database.

## Design decisions intentionally left open

Chunk size, overlap, token-counting strategy, paragraph-boundary rules, and handling of tables/equations must be established and tested before implementation. These values must not be guessed or hard-coded arbitrarily.

The chunker must not modify the validator or extractor's responsibilities.
