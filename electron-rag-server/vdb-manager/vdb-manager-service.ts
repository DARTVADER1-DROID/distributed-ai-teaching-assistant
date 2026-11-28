import type { ExtractionResult } from "../extractor/extractor-service.js";
import type { Course, CreateCourseRequest } from "./course.js";
import type { CoursePipelineResult } from "./create-course.js";
import { CreateCourse } from "./create-course.js";
import { UpdateCourse } from "./update-course.js";
import { DeleteCourse } from "./delete-course.js";
import { GetCourse } from "./get-course.js";
import { GetAllCourses } from "./get-all-courses.js";
import { DeleteAllCourses } from "./delete-all-courses.js";

/** Coordinates course operations for the vector database layer. */
export class VdbManagerService {
  private readonly updateCourseOperation = new UpdateCourse();
  private readonly deleteCourseOperation = new DeleteCourse();
  private readonly getCourseOperation = new GetCourse();
  private readonly getAllCoursesOperation = new GetAllCourses();
  private readonly deleteAllCoursesOperation = new DeleteAllCourses();

  public constructor(
    private readonly createCourseOperation: CreateCourse,
  ) {}

  /** Runs the configured PDF-to-embedding pipeline for a new course. */
  public createCourse(request: CreateCourseRequest): Promise<CoursePipelineResult> {
    return this.createCourseOperation.execute(request);
  }

  /** Replaces all existing extracted material with replacementMaterial. */
  public updateCourse(
    courseId: string,
    replacementMaterial: ExtractionResult,
  ): Promise<void> {
    return this.updateCourseOperation.execute(courseId, replacementMaterial);
  }

  public deleteCourse(courseId: string): Promise<void> {
    return this.deleteCourseOperation.execute(courseId);
  }

  public getCourse(courseId: string): Promise<Course | null> {
    return this.getCourseOperation.execute(courseId);
  }

  public getAllCourses(): Promise<Course[]> {
    return this.getAllCoursesOperation.execute();
  }

  public deleteAllCourses(): Promise<void> {
    return this.deleteAllCoursesOperation.execute();
  }
}
