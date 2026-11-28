import type { CourseIdentity } from "./course.js";
import { CourseDuplicateChecker } from "./course-duplicate-checker.js";
import { CourseIdGenerator } from "./course-id-generator.js";
import {
  calculateDocumentHash,
  normalizeDocumentName,
} from "./document-fingerprint.js";

/** Creates stable course identity metadata after duplicate validation. */
export class CourseIdentityFactory {
  public constructor(
    private readonly duplicateChecker: CourseDuplicateChecker,
    private readonly idGenerator: CourseIdGenerator = new CourseIdGenerator(),
  ) {}

  public async createIdentity(
    documentName: string,
    documentBytes: Uint8Array,
    existingCourseId?: string,
  ): Promise<CourseIdentity> {
    const normalizedName = normalizeDocumentName(documentName);
    const documentHash = calculateDocumentHash(documentBytes);

    await this.duplicateChecker.assertUnique(
      normalizedName.displayName,
      documentHash,
      existingCourseId,
    );

    return {
      course_id: existingCourseId ?? this.idGenerator.generate(),
      document_name: normalizedName.displayName,
      document_name_key: normalizedName.key,
      document_hash: documentHash,
    };
  }
}
