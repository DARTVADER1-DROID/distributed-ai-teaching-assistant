import type { EmbeddingService } from "../embedding/embedding-service.js";
import { CourseRepository, CourseNotFoundError } from "./course-repository.js";

export interface SearchCoursesOptions {
  course_id?: string;
  top_k?: number;
}

export interface RetrievedChunk {
  chunk_id: string;
  course_id: string;
  document_name: string;
  chunk_index: number;
  content: string;
  heading_path: string[];
  token_count: number;
  start_page_number: number;
  start_line_number: number;
  end_page_number: number;
  end_line_number: number;
  distance: number;
}

export interface SearchCoursesResult {
  query: string;
  course_id: string | null;
  top_k: number;
  results: RetrievedChunk[];
}

/** Embeds a natural-language query and retrieves matching active course chunks. */
export class SearchCourses {
  public constructor(
    private readonly repository: CourseRepository,
    private readonly embedder: Pick<EmbeddingService, "embedTexts">,
  ) {}

  public async execute(
    query: string,
    options: SearchCoursesOptions = {},
  ): Promise<SearchCoursesResult> {
    if (typeof query !== "string" || query.trim().length === 0) {
      throw new SearchInputError("Query must be a non-empty string.");
    }
    if (query.length > 8000) {
      throw new SearchInputError("Query cannot exceed 8000 characters.");
    }

    const topK = options.top_k ?? 5;
    if (!Number.isSafeInteger(topK) || topK < 1 || topK > 50) {
      throw new SearchInputError("top_k must be an integer between 1 and 50.");
    }
    if (options.course_id !== undefined &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(options.course_id)) {
      throw new SearchInputError("course_id must be a valid UUID.");
    }

    const embedded = await this.embedder.embedTexts([query.trim()]);
    const vector = embedded.embeddings[0];
    if (
      embedded.dimensions !== 1024 ||
      embedded.embeddings.length !== 1 ||
      !vector ||
      vector.length !== 1024 ||
      vector.some((value) => !Number.isFinite(value))
    ) {
      throw new Error("Query embedding must contain exactly one finite 1024-dimensional vector.");
    }

    const results = await this.repository.search(vector, topK, embedded.model_id, options.course_id);
    return {
      query: query.trim(),
      course_id: options.course_id ?? null,
      top_k: topK,
      results,
    };
  }
}

export class SearchInputError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "SearchInputError";
  }
}
