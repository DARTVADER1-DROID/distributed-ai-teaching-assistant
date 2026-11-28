import { randomUUID } from "node:crypto";

/** Generates opaque UUID v4 course identifiers without user input. */
export class CourseIdGenerator {
  public generate(): string {
    return randomUUID();
  }
}
