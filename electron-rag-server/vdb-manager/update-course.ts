import type { CreateCourseRequest } from "./course.js";
import type { CoursePipelineResult } from "./create-course.js";
import { CreateCourse } from "./create-course.js";
import { CourseRepository, CourseNotFoundError } from "./course-repository.js";
import { calculateDocumentHash, normalizeDocumentName } from "./document-fingerprint.js";

/** Raised when an update would leave both the filename and content unchanged. */
export class CourseUnchangedError extends Error {
  public constructor(courseId: string) {
    super(`Course '${courseId}' is already up to date; the filename and document content are unchanged.`);
    this.name = "CourseUnchangedError";
  }
}

/** Reprocesses a replacement PDF and switches the course to its new chunk generation. */
export class UpdateCourse {
  public constructor(
    private readonly pipeline: CreateCourse,
    private readonly repository: CourseRepository,
  ) {}

  public async execute(
    courseId: string,
    replacement: CreateCourseRequest,
  ): Promise<CoursePipelineResult> {
    // Fail early for unknown IDs and avoid loading the tokenizer/model unnecessarily.
    const existing = await this.repository.get(courseId);
    if (!existing) {
      throw new CourseNotFoundError(courseId);
    }

    // A true no-op is identified before the expensive PDF/embedding pipeline.
    const replacementName = normalizeDocumentName(replacement.document_name);
    const replacementHash = calculateDocumentHash(replacement.document_bytes);
    const existingName = normalizeDocumentName(existing.document_name);

    if (
      existingName.key === replacementName.key &&
      existing.document_hash.toLowerCase() === replacementHash.toLowerCase()
    ) {
      throw new CourseUnchangedError(courseId);
    }

    // The pipeline excludes this course from duplicate checks while preserving
    // the course ID. All parsing, validation and embedding finish before writes.
    const result = await this.pipeline.execute(replacement, courseId);
    await this.repository.replace(courseId, result);
    return result;
  }
}
