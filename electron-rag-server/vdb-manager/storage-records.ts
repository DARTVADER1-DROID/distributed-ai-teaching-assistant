import type { ExtractionResult } from "../extractor/extractor-service.js";

/** Persisted course catalogue row. */
export interface CourseRecord {
  course_id: string;
  /** Original uploaded filename, kept for display. */
  document_name: string;
  /** Canonical case-insensitive filename key used for duplicate checks. */
  document_name_key: string;
  /** SHA-256 of the exact uploaded PDF bytes. */
  document_hash: string;
  /** Complete ExtractionResult serialized as JSON. */
  material_json: string;
  active_generation_id: string;
  created_at: string;
  updated_at: string;
}

/** One searchable chunk and its corresponding dense vector. */
export interface CourseChunkRecord {
  chunk_id: string;
  course_id: string;
  generation_id: string;
  chunk_index: number;
  vector: number[];
  embedding_model_id: string;
  embedding_dimensions: number;
  content: string;
  embedding_text: string;
  heading_path_json: string;
  token_count: number;
  start_page_number: number;
  start_line_number: number;
  end_page_number: number;
  end_line_number: number;
}

export function serializeCourseMaterial(material: ExtractionResult): string {
  return JSON.stringify(material);
}

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
