import type { Course, CreateCourseRequest } from "./course.js";
import type { CoursePipelineResult } from "./create-course.js";
import type { EmbeddingService } from "../embedding/embedding-service.js";
import { SearchCourses, type SearchCoursesOptions } from "./search-courses.js";
import { CreateCourse } from "./create-course.js";
import { CourseRepository } from "./course-repository.js";
import { CreateCourseOperation } from "./create-course-operation.js";
import { UpdateCourse } from "./update-course.js";
import { DeleteCourse } from "./delete-course.js";
import { GetCourse } from "./get-course.js";
import { GetAllCourses } from "./get-all-courses.js";
import { DeleteAllCourses } from "./delete-all-courses.js";

/**
 * Application entry point for course lifecycle and semantic retrieval operations.
 * Writes are serialized so duplicate detection and catalogue mutations cannot
 * race each other inside this server process.
 */
export class VdbManagerService {
  private readonly createOperation: CreateCourseOperation;
  private readonly updateOperation: UpdateCourse;
  private readonly deleteOperation: DeleteCourse;
  private readonly getOperation: GetCourse;
  private readonly getAllOperation: GetAllCourses;
  private readonly deleteAllOperation: DeleteAllCourses;
  private readonly searchOperation: SearchCourses;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(
    pipeline: CreateCourse,
    private readonly repository: CourseRepository,
    queryEmbedder: Pick<EmbeddingService, "embedTexts">,
  ) {
    this.createOperation = new CreateCourseOperation(pipeline, repository);
    this.updateOperation = new UpdateCourse(pipeline, repository);
    this.deleteOperation = new DeleteCourse(repository);
    this.getOperation = new GetCourse(repository);
    this.getAllOperation = new GetAllCourses(repository);
    this.deleteAllOperation = new DeleteAllCourses(repository);
    this.searchOperation = new SearchCourses(repository, queryEmbedder);
  }

  public createCourse(request: CreateCourseRequest): Promise<CoursePipelineResult> {
    return this.serializeWrite(() => this.createOperation.execute(request));
  }

  public updateCourse(
    courseId: string,
    replacement: CreateCourseRequest,
  ): Promise<CoursePipelineResult> {
    return this.serializeWrite(() => this.updateOperation.execute(courseId, replacement));
  }

  public deleteCourse(courseId: string): Promise<boolean> {
    return this.serializeWrite(() => this.deleteOperation.execute(courseId));
  }

  public getCourse(courseId: string): Promise<Course | null> {
    return this.getOperation.execute(courseId);
  }

  public getAllCourses(): Promise<Course[]> {
    return this.getAllOperation.execute();
  }

  public searchCourses(query: string, options: SearchCoursesOptions = {}) {
    return this.searchOperation.execute(query, options);
  }

  public deleteAllCourses(): Promise<number> {
    return this.serializeWrite(() => this.deleteAllOperation.execute());
  }

  private serializeWrite<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation);
    this.writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}
