import type { Course } from "./course.js";

/**
 * Creates a course only when its course_id does not already exist.
 * A duplicate must raise CourseAlreadyExistsError; no overwrite is allowed.
 */
export class CreateCourse {
  public async execute(_course: Course): Promise<void> {
    throw new Error("CreateCourse is not implemented.");
  }
}
