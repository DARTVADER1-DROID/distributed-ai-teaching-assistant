import { CourseRepository } from "./course-repository.js";

/** Deletes one course and all of its chunk generations. */
export class DeleteCourse {
  public constructor(private readonly repository: CourseRepository) {}

  public async execute(courseId: string): Promise<boolean> {
    return this.repository.delete(courseId);
  }
}
