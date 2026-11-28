import { createHash } from "node:crypto";
import { basename } from "node:path";

/** Returns a stable, case-insensitive key for an uploaded filename. */
export function normalizeDocumentName(documentName: string): {
  displayName: string;
  key: string;
} {
  if (typeof documentName !== "string") {
    throw new TypeError("Document filename must be a string.");
  }

  // Handle both POSIX and Windows separators, independent of host OS.
  const fileName = basename(documentName.replaceAll("\\", "/")).trim().normalize("NFC");
  if (fileName.length === 0 || fileName === "." || fileName === "..") {
    throw new Error("Document filename cannot be empty.");
  }

  return {
    displayName: fileName,
    key: fileName.toLocaleLowerCase("en-US"),
  };
}

/** Calculates SHA-256 over the exact uploaded bytes (not the filename). */
export function calculateDocumentHash(documentBytes: Uint8Array): string {
  if (!(documentBytes instanceof Uint8Array) || documentBytes.byteLength === 0) {
    throw new Error("Document bytes must be a non-empty Uint8Array.");
  }

  return createHash("sha256").update(documentBytes).digest("hex");
}
