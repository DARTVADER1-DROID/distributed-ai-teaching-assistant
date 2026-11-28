import { CourseRepository } from "./course-repository.js";

/** Deletes all course catalogue rows and all associated chunks. */
export class DeleteAllCourses {
  public constructor(private readonly repository: CourseRepository) {}

  public async execute(): Promise<number> {
    return this.repository.deleteAll();
  }
}
