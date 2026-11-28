import {
  Field,
  FixedSizeList,
  Float32,
  Int32,
  Schema,
  Utf8,
} from "apache-arrow";
import { EmbeddingService } from "../embedding/embedding-service.js";

/** Stable LanceDB table names used by all VDB manager operations. */
export const COURSE_TABLE_NAME = "courses";
export const COURSE_CHUNK_TABLE_NAME = "course_chunks";

/** Keep the vector width tied to the embedding service's declared contract. */
export const COURSE_VECTOR_DIMENSIONS = EmbeddingService.dimensions;

/**
 * Catalogue schema: one row per course.
 * The complete ExtractionResult remains a JSON payload, preserving its
 * recursive heading/paragraph hierarchy without flattening it into rows.
 */
export function createCourseTableSchema(): Schema {
  return new Schema([
    new Field("course_id", new Utf8(), false),
    new Field("material_json", new Utf8(), false),
    new Field("active_generation_id", new Utf8(), false),
    new Field("created_at", new Utf8(), false),
    new Field("updated_at", new Utf8(), false),
  ]);
}

/**
 * Search schema: one row per chunk generation entry.
 * FixedSizeList<Float32> makes vector dimensionality part of the Arrow schema.
 */
export function createCourseChunkTableSchema(): Schema {
  return new Schema([
    new Field("chunk_id", new Utf8(), false),
    new Field("course_id", new Utf8(), false),
    new Field("generation_id", new Utf8(), false),
    new Field("chunk_index", new Int32(), false),
    new Field(
      "vector",
      new FixedSizeList(
        COURSE_VECTOR_DIMENSIONS,
        new Field("item", new Float32(), true),
      ),
      false,
    ),
    new Field("embedding_model_id", new Utf8(), false),
    new Field("embedding_dimensions", new Int32(), false),
    new Field("content", new Utf8(), false),
    new Field("embedding_text", new Utf8(), false),
    new Field("heading_path_json", new Utf8(), false),
    new Field("token_count", new Int32(), false),
    new Field("start_page_number", new Int32(), false),
    new Field("start_line_number", new Int32(), false),
    new Field("end_page_number", new Int32(), false),
    new Field("end_line_number", new Int32(), false),
  ]);
}
