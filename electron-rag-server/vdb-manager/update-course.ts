import type { CreateCourseRequest } from "./course.js";
import type { CoursePipelineResult } from "./create-course.js";
import { CreateCourse } from "./create-course.js";
import { CourseRepository } from "./course-repository.js";

/** Reprocesses a replacement PDF and switches the course to its new chunk generation. */
export class UpdateCourse {
  public constructor(
    private readonly pipeline: CreateCourse,
    private readonly repository: CourseRepository,
  ) {}

  public async execute(
    courseId: string,
    replacement: CreateCourseRequest,
  ): Promise<CoursePipelineResult> {
    const result = await this.pipeline.execute(replacement, courseId);
    await this.repository.replace(courseId, result);
    return result;
  }
}
