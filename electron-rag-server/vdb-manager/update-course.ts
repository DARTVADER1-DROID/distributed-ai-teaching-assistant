import type { ExtractionResult } from "../extractor/extractor-service.js";

/**
 * Replaces the entire extracted material for an existing course.
 * This is a full replacement operation, not a partial update or merge.
 */
export class UpdateCourse {
  public async execute(
    _courseId: string,
    _replacementMaterial: ExtractionResult,
  ): Promise<void> {
    throw new Error("UpdateCourse is not implemented.");
  }
}
