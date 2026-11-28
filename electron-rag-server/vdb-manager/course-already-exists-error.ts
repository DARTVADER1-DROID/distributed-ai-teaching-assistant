/**
 * Raised by CreateCourse when a course_id is already present.
 */
export class CourseAlreadyExistsError extends Error {
  public constructor(courseId: string) {
    super(`Course '${courseId}' already exists.`);
    this.name = "CourseAlreadyExistsError";
  }
}
