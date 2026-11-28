import type { Table } from "@lancedb/lancedb";
import { CourseDuplicateError } from "./course-duplicate-error.js";
import { normalizeDocumentName } from "./document-fingerprint.js";

/** Checks filename and exact-byte uniqueness in the persisted catalogue. */
export class CourseDuplicateChecker {
  public constructor(private readonly coursesTable: Table) {}

  public async assertUnique(
    documentName: string,
    documentHash: string,
    excludeCourseId?: string,
  ): Promise<void> {
    const normalizedName = normalizeDocumentName(documentName);
    if (!/^[a-f0-9]{64}$/i.test(documentHash)) {
      throw new Error("Document hash must be a 64-character SHA-256 hex digest.");
    }

    const exclusion = excludeCourseId
      ? ` AND course_id != '${this.escapeSqlString(excludeCourseId)}'`
      : "";

    const nameMatch = await this.coursesTable
      .query()
      .where(`document_name_key = '${this.escapeSqlString(normalizedName.key)}'${exclusion}`)
      .limit(1)
      .toArray();

    if (nameMatch.length > 0) {
      throw new CourseDuplicateError(
        "DOCUMENT_NAME_ALREADY_EXISTS",
        normalizedName.displayName,
      );
    }

    const hash = documentHash.toLowerCase();
    const contentMatch = await this.coursesTable
      .query()
      .where(`document_hash = '${hash}'${exclusion}`)
      .limit(1)
      .toArray();

    if (contentMatch.length > 0) {
      throw new CourseDuplicateError("DOCUMENT_CONTENT_ALREADY_EXISTS", hash);
    }
  }

  private escapeSqlString(value: string): string {
    return value.replaceAll("'", "''");
  }
}
