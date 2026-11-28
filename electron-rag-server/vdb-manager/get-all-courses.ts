import type { Course } from "./course.js";
import { CourseRepository } from "./course-repository.js";

/** Retrieves every stored course. */
export class GetAllCourses {
  public constructor(private readonly repository: CourseRepository) {}

  public async execute(): Promise<Course[]> {
    return this.repository.getAll();
  }
}
