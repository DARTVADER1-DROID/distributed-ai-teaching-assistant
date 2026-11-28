import type { Course } from "./course.js";

/**
 * Retrieves one course by its unique course_id.
 */
export class GetCourse {
  public async execute(_courseId: string): Promise<Course | null> {
    throw new Error("GetCourse is not implemented.");
  }
}
