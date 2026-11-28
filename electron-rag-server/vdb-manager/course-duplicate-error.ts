export type CourseDuplicateReason =
  | "DOCUMENT_NAME_ALREADY_EXISTS"
  | "DOCUMENT_CONTENT_ALREADY_EXISTS";

/** Raised when an uploaded document conflicts with an existing course. */
export class CourseDuplicateError extends Error {
  public constructor(
    public readonly reason: CourseDuplicateReason,
    public readonly conflictingValue: string,
  ) {
    super(
      reason === "DOCUMENT_NAME_ALREADY_EXISTS"
        ? `A course named '${conflictingValue}' already exists.`
        : `The uploaded document content already exists (SHA-256: ${conflictingValue}).`,
    );
    this.name = "CourseDuplicateError";
  }
}
