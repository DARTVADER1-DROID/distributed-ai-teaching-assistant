import type { ExtractionResult } from "../extractor/extractor-service.js";

/**
 * Persisted course catalogue row.
 *
 * material_json stores the complete extraction hierarchy. It is deliberately
 * kept independently of the chunk table so course retrieval does not need to
 * rebuild a document tree from vector records.
 */
export interface CourseRecord {
  /** Stable application-level course identifier. */
  course_id: string;
  /** Complete ExtractionResult serialized as JSON. */
  material_json: string;
  /** Identifies the chunk generation currently used for retrieval. */
  active_generation_id: string;
  /** ISO-8601 timestamps. */
  created_at: string;
  updated_at: string;
}

/**
 * Persisted searchable chunk row.
 *
 * One row represents one DocumentChunk and its corresponding dense vector.
 * heading_path_json is JSON-encoded to keep the LanceDB column scalar and
 * straightforward to deserialize across SDK versions.
 */
export interface CourseChunkRecord {
  /** Unique row identifier within the chunk table. */
  chunk_id: string;
  course_id: string;
  /** Groups all chunks created from one complete course-material version. */
  generation_id: string;
  /** Zero-based order from ChunkingResult.chunks. */
  chunk_index: number;

  /** Normalized dense embedding produced from embedding_text. */
  vector: number[];
  embedding_model_id: string;
  embedding_dimensions: number;

  /** Original chunk text, without synthetic heading prefixes. */
  content: string;
  /** Exact text supplied to the embedding model. */
  embedding_text: string;
  /** JSON-encoded DocumentChunk.heading_path. */
  heading_path_json: string;
  /** Exact tokenizer count for embedding_text. */
  token_count: number;

  /** Source location copied from DocumentChunk. */
  start_page_number: number;
  start_line_number: number;
  end_page_number: number;
  end_line_number: number;
}

/** Converts the complete domain material to the catalogue's JSON payload. */
export function serializeCourseMaterial(material: ExtractionResult): string {
  return JSON.stringify(material);
}

/** Restores the complete domain material from a catalogue row. */
export function deserializeCourseMaterial(record: CourseRecord): ExtractionResult {
  const parsed: unknown = JSON.parse(record.material_json);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("is_successful" in parsed) ||
    !("error" in parsed) ||
    !("document" in parsed)
  ) {
    throw new Error(
      `Stored material for course '${record.course_id}' is not a valid ExtractionResult payload.`,
    );
  }

  return parsed as ExtractionResult;
}
