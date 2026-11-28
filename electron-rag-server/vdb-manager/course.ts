import type { ExtractionResult } from "../extractor/extractor-service.js";

/**
 * A course record managed by the vector database layer.
 * course_id is the unique identity; material is the complete extracted course.
 */
export interface Course {
  course_id: string;
  material: ExtractionResult;
}
