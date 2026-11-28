import type { CreateCourseRequest } from "./course.js";
import type { CoursePipelineResult } from "./create-course.js";
import { CreateCourse } from "./create-course.js";
import { CourseRepository } from "./course-repository.js";

/** Processes and persists a newly uploaded course. */
export class CreateCourseOperation {
  public constructor(
    private readonly pipeline: CreateCourse,
    private readonly repository: CourseRepository,
  ) {}

  public async execute(request: CreateCourseRequest): Promise<CoursePipelineResult> {
    const result = await this.pipeline.execute(request);
    await this.repository.create(result);
    return result;
  }
}
