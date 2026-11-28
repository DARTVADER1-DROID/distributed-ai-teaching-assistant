import type { ExtractionResult } from "../extractor/extractor-service.js";

/** A fully created course returned by the VDB manager. */
export interface Course {
  /** Automatically generated UUID v4. */
  course_id: string;
  /** Original uploaded filename, without any client-supplied directory path. */
  document_name: string;
  /** SHA-256 fingerprint of the exact uploaded file bytes. */
  document_hash: string;
  material: ExtractionResult;
}

/** Upload input. The caller never supplies a course ID or content hash. */
export interface CreateCourseRequest {
  document_name: string;
  document_bytes: Uint8Array;
}

/** Identity metadata prepared after duplicate checks pass. */
export interface CourseIdentity {
  course_id: string;
  document_name: string;
  document_name_key: string;
  document_hash: string;
}
