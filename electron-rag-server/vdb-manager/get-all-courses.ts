import type { Course } from "./course.js";

/**
 * Retrieves all stored courses.
 */
export class GetAllCourses {
  public async execute(): Promise<Course[]> {
    throw new Error("GetAllCourses is not implemented.");
  }
}
