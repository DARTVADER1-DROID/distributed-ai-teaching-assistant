/**
 * TypeScript translation of rag-server/chunker/chunker_service.cpp.
 *
 * Converts the extracted document tree into ordered, tokenizer-bounded chunks.
 * The tokenizer is injected so token counts match the selected embedding model.
 */

import { ChunkerConfig } from "./config/chunker-config";
import {
  DocumentNode,
  DocumentNodeType,
  ExtractionResult,
} from "../extractor/extractor-service";

export type TokenCounter = (text: string) => number;

export interface DocumentChunk {
  /** Zero-based position in the ordered chunk collection. */
  index: number;
  /** Original extracted content, without synthetic heading prefixes. */
  text: string;
  /** Heading context plus original content; send this to the embedding model. */
  embedding_text: string;
  /** Heading titles from the document root to the section containing this chunk. */
  heading_path: string[];
  start_page_number: number;
  start_line_number: number;
  end_page_number: number;
  end_line_number: number;
}

export interface ChunkingResult {
  is_successful: boolean;
  error: string;
  chunks: DocumentChunk[];
}

interface SourceRange {
  start_page: number;
  end_page: number;
  start_line: number;
  end_line: number;
}

function makeEmbeddingText(headingPath: string[], content: string): string {
  if (headingPath.length === 0) {
    return content;
  }
  return headingPath.join(" > ") + "\n" + content;
}

function countTokens(
  counter: TokenCounter,
  headingPath: string[],
  content: string,
): number {
  const count = counter(makeEmbeddingText(headingPath, content));
  if (!Number.isFinite(count) || count < 0) {
    throw new Error("The tokenizer returned an invalid token count.");
  }
  return Math.ceil(count);
}

function isSentenceBoundary(previous: string, current: string): boolean {
  return (
    (previous === "." || previous === "?" || previous === "!") &&
    /^[ \t\r\n]$/.test(current)
  );
}

function isClauseBoundary(previous: string, current: string): boolean {
  return (
    (previous === "," || previous === ";" || previous === ":") &&
    /^[ \t\r\n]$/.test(current)
  );
}

/**
 * JavaScript string offsets are UTF-16 offsets. Building boundaries from
 * Unicode code points prevents splitting a surrogate pair.
 */
function utf16Boundaries(value: string): number[] {
  const boundaries = [0];
  let offset = 0;
  for (const character of value) {
    offset += character.length;
    boundaries.push(offset);
  }
  return boundaries;
}

/** Largest prefix that fits; prefer sentence, clause, then whitespace boundaries. */
function findSplitPosition(
  value: string,
  boundaries: number[],
  start: number,
  maxTokens: number,
  headingPath: string[],
  counter: TokenCounter,
): number {
  let low = boundaries.findIndex((boundary) => boundary > start);
  let high = boundaries.length - 1;
  let best = start;

  while (low <= high) {
    const middle = low + Math.floor((high - low) / 2);
    const end = boundaries[middle];
    const candidate = value.slice(start, end);

    if (countTokens(counter, headingPath, candidate) <= maxTokens) {
      best = end;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (best === start) {
    return start;
  }

  let sentence = 0;
  let clause = 0;
  let whitespace = 0;

  for (const boundary of boundaries) {
    if (boundary <= start || boundary > best) {
      continue;
    }

    const previous = value[boundary - 1];
    const current = boundary < value.length ? value[boundary] : "";
    if (
      boundary === value.length ||
      /^[ \t\r\n]$/.test(current)
    ) {
      whitespace = boundary;
    }
    if (boundary < value.length && isClauseBoundary(previous, current)) {
      clause = boundary;
    }
    if (boundary < value.length && isSentenceBoundary(previous, current)) {
      sentence = boundary;
    }
  }

  return sentence || clause || whitespace || best;
}

function splitOversizedParagraph(
  paragraph: string,
  headingPath: string[],
  maxTokens: number,
  counter: TokenCounter,
): string[] {
  const pieces: string[] = [];
  const boundaries = utf16Boundaries(paragraph);
  let start = 0;

  while (start < paragraph.length) {
    const remaining = paragraph.slice(start);
    if (countTokens(counter, headingPath, remaining) <= maxTokens) {
      pieces.push(remaining);
      break;
    }

    const split = findSplitPosition(
      paragraph,
      boundaries,
      start,
      maxTokens,
      headingPath,
      counter,
    );

    if (split <= start) {
      throw new Error(
        "A single Unicode character or tokenizer unit exceeds the configured chunk token limit.",
      );
    }

    pieces.push(paragraph.slice(start, split));
    start = split;
  }

  return pieces;
}

function sourceRange(node: DocumentNode): SourceRange {
  return {
    start_page: node.page_number,
    end_page: node.end_page_number || node.page_number,
    start_line: node.line_number,
    end_line: node.end_line_number || node.line_number,
  };
}

function updateRange(
  chunk: DocumentChunk,
  source: SourceRange,
  firstContent: boolean,
): void {
  if (firstContent) {
    chunk.start_page_number = source.start_page;
    chunk.start_line_number = source.start_line;
  }
  if (source.end_page !== 0) {
    chunk.end_page_number = source.end_page;
  }
  if (source.end_line !== 0) {
    chunk.end_line_number = source.end_line;
  }
}

class ChunkBuilder {
  public constructor(
    private readonly maxTokens: number,
    private readonly counter: TokenCounter,
    private readonly output: DocumentChunk[],
  ) {}

  public processParagraphGroup(
    paragraphs: DocumentNode[],
    headingPath: string[],
  ): void {
    let current: DocumentChunk = this.createEmptyChunk();
    let hasContent = false;

    const flush = (): void => {
      if (!hasContent) {
        return;
      }
      current.index = this.output.length;
      current.heading_path = [...headingPath];
      current.embedding_text = makeEmbeddingText(headingPath, current.text);
      this.output.push(current);
      current = this.createEmptyChunk();
      hasContent = false;
    };

    for (const paragraphNode of paragraphs) {
      if (paragraphNode.text.length === 0) {
        continue;
      }

      const source = sourceRange(paragraphNode);
      const pieces =
        countTokens(this.counter, headingPath, paragraphNode.text) <=
        this.maxTokens
          ? [paragraphNode.text]
          : splitOversizedParagraph(
              paragraphNode.text,
              headingPath,
              this.maxTokens,
              this.counter,
            );

      let firstPiece = true;
      for (const piece of pieces) {
        const separator = hasContent && firstPiece ? "\n\n" : "";
        const candidate = current.text + separator + piece;

        if (
          hasContent &&
          countTokens(this.counter, headingPath, candidate) > this.maxTokens
        ) {
          flush();
        }

        const actualSeparator = hasContent && firstPiece ? "\n\n" : "";
        const updated = current.text + actualSeparator + piece;

        if (
          countTokens(this.counter, headingPath, updated) > this.maxTokens
        ) {
          flush();
          if (
            countTokens(this.counter, headingPath, piece) > this.maxTokens
          ) {
            throw new Error(
              "A paragraph fragment exceeds the configured chunk token limit.",
            );
          }
        }

        const startsChunk = !hasContent;
        if (hasContent) {
          if (firstPiece) {
            current.text += "\n\n";
          }
          current.text += piece;
        } else {
          current.text = piece;
          hasContent = true;
        }

        updateRange(current, source, startsChunk);
        firstPiece = false;
      }
    }

    flush();
  }

  private createEmptyChunk(): DocumentChunk {
    return {
      index: 0,
      text: "",
      embedding_text: "",
      heading_path: [],
      start_page_number: 0,
      start_line_number: 0,
      end_page_number: 0,
      end_line_number: 0,
    };
  }
}

function traverse(
  node: DocumentNode,
  headingPath: string[],
  builder: ChunkBuilder,
): void {
  let paragraphGroup: DocumentNode[] = [];

  const flushGroup = (): void => {
    if (paragraphGroup.length > 0) {
      builder.processParagraphGroup(paragraphGroup, headingPath);
      paragraphGroup = [];
    }
  };

  for (const child of node.children) {
    if (child.type === DocumentNodeType.Paragraph) {
      paragraphGroup.push(child);
      continue;
    }

    flushGroup();

    if (child.type === DocumentNodeType.Heading) {
      headingPath.push(child.text);
      traverse(child, headingPath, builder);
      headingPath.pop();
    } else if (child.type === DocumentNodeType.Document) {
      traverse(child, headingPath, builder);
    }
  }

  flushGroup();
}

export class ChunkerService {
  private readonly config: ChunkerConfig;

  public constructor(
    config: Partial<ChunkerConfig>,
    private readonly tokenCounter?: TokenCounter,
  ) {
    this.config = new ChunkerConfig(config);
  }

  /** Converts a successful extraction result into ordered embedding-ready chunks. */
  public chunkDocument(extraction: ExtractionResult): ChunkingResult {
    const result: ChunkingResult = {
      is_successful: false,
      error: "",
      chunks: [],
    };

    if (!extraction.is_successful) {
      result.error = extraction.error
        ? `Extraction failed: ${extraction.error}`
        : "Cannot chunk an unsuccessful extraction result.";
      return result;
    }

    if (extraction.document.type !== DocumentNodeType.Document) {
      result.error = "Extraction result does not contain a document root.";
      return result;
    }

    if (
      !Number.isSafeInteger(this.config.max_chunk_tokens) ||
      this.config.max_chunk_tokens <= 0
    ) {
      result.error =
        "The configured maximum chunk token limit must be greater than zero.";
      return result;
    }

    if (!this.tokenCounter) {
      result.error =
        "No tokenizer token-counting function was supplied. Provide the exact tokenizer used by the embedding model.";
      return result;
    }

    try {
      const builder = new ChunkBuilder(
        this.config.max_chunk_tokens,
        this.tokenCounter,
        result.chunks,
      );
      traverse(extraction.document, [], builder);
      result.is_successful = true;
    } catch (error) {
      result.chunks = [];
      result.error =
        error instanceof Error
          ? `Chunking failed: ${error.message}`
          : "Chunking failed due to an unknown tokenizer or processing error.";
    }

    return result;
  }
}
