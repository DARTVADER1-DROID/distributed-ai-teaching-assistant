import type { Course, CreateCourseRequest } from "./course.js";

/**
 * Creates a course from uploaded document bytes.
 * The caller supplies neither a course ID nor a content hash; identity is
 * prepared internally after duplicate checks pass.
 *
 * The PDF processing and persistence pipeline will be added in a later step.
 */
export class CreateCourse {
  public async execute(_request: CreateCourseRequest): Promise<Course> {
    throw new Error("CreateCourse processing and persistence are not implemented yet.");
  }
}
