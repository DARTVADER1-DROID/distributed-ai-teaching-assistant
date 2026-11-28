import type { CourseIdentity } from "./course.js";
import { CourseDuplicateChecker } from "./course-duplicate-checker.js";
import { CourseIdGenerator } from "./course-id-generator.js";
import {
  calculateDocumentHash,
  normalizeDocumentName,
} from "./document-fingerprint.js";

/**
 * Prepares identity metadata for a new upload:
 * normalize filename -> fingerprint bytes -> reject duplicates -> assign UUID.
 *
 * It deliberately does not persist a course. CreateCourse will call this
 * factory before running the document-processing pipeline and storing results.
 */
export class CourseIdentityFactory {
  public constructor(
    private readonly duplicateChecker: CourseDuplicateChecker,
    private readonly idGenerator: CourseIdGenerator = new CourseIdGenerator(),
  ) {}

  public async createIdentity(
    documentName: string,
    documentBytes: Uint8Array,
  ): Promise<CourseIdentity> {
    const normalizedName = normalizeDocumentName(documentName);
    const documentHash = calculateDocumentHash(documentBytes);

    await this.duplicateChecker.assertUnique(
      normalizedName.displayName,
      documentHash,
    );

    return {
      course_id: this.idGenerator.generate(),
      document_name: normalizedName.displayName,
      document_name_key: normalizedName.key,
      document_hash: documentHash,
    };
  }
}
