/**
 * Deletes one course by its unique course_id.
 */
export class DeleteCourse {
  public async execute(_courseId: string): Promise<void> {
    throw new Error("DeleteCourse is not implemented.");
  }
}
