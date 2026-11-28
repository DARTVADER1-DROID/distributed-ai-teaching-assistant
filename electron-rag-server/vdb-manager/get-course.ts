import type { Course } from "./course.js";
import { CourseRepository } from "./course-repository.js";

/** Retrieves one stored course by UUID. */
export class GetCourse {
  public constructor(private readonly repository: CourseRepository) {}

  public async execute(courseId: string): Promise<Course | null> {
    return this.repository.get(courseId);
  }
}
