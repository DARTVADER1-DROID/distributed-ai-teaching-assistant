import { RagConfig } from "../config/config.js";
import { ChunkerService, type DocumentChunk } from "../chunker/chunker-service.js";
import type { ExtractionResult } from "../extractor/extractor-service.js";
import type { EmbeddingResult } from "../embedding/embedding-service.js";
import type { BgeM3Tokenizer } from "../embedding/bge-m3-tokenizer.js";
import type { EmbeddingService } from "../embedding/embedding-service.js";
import type { PdfJsDocumentParser } from "../pdf/pdfjs-document-parser.js";
import type { ValidatorService } from "../validator/validator-service.js";
import type { ValidationReport } from "../validator/font-size-validator.js";
import type { CourseIdentity, CreateCourseRequest } from "./course.js";
import type { CourseIdentityFactory } from "./course-identity-factory.js";

export interface CoursePipelineResult {
  identity: CourseIdentity;
  validation: ValidationReport;
  material: ExtractionResult;
  chunks: DocumentChunk[];
  embeddings: EmbeddingResult;
  page_count: number;
}

export interface CoursePipelineDependencies {
  identityFactory: Pick<CourseIdentityFactory, "createIdentity">;
  pdfParser: Pick<
    PdfJsDocumentParser,
    "parseWithMetrics" | "toExtractedPdfData"
  >;
  validator: Pick<ValidatorService, "validate">;
  extractor: {
    extractParsedDocument: (document: Awaited<
      ReturnType<PdfJsDocumentParser["parse"]>
    >) => ExtractionResult;
  };
  config: RagConfig;
  loadTokenizer: () => Promise<Pick<BgeM3Tokenizer, "countTokens">>;
  loadEmbedder: () => Promise<Pick<EmbeddingService, "embedTexts">>;
}

/** Identifies which processing stage rejected a course upload. */
export class CourseCreationStageError extends Error {
  public constructor(
    public readonly stage:
      | "identity"
      | "pdf_parsing"
      | "validation"
      | "extraction"
      | "chunking"
      | "embedding",
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "CourseCreationStageError";
  }
}

/**
 * Orchestrates the document-processing pipeline for a new course.
 *
 * This class intentionally stops after producing validated material, chunks,
 * and vectors. Persistence to the two LanceDB tables is the next stage and is
 * not performed here yet.
 */
export class CreateCourse {
  private tokenizerPromise?: Promise<Pick<BgeM3Tokenizer, "countTokens">>;
  private embedderPromise?: Promise<Pick<EmbeddingService, "embedTexts">>;

  public constructor(
    private readonly dependencies: CoursePipelineDependencies,
  ) {}

  public async execute(
    request: CreateCourseRequest,
  ): Promise<CoursePipelineResult> {
    let identity: CourseIdentity;

    try {
      identity = await this.dependencies.identityFactory.createIdentity(
        request.document_name,
        request.document_bytes,
      );
    } catch (error) {
      throw new CourseCreationStageError(
        "identity",
        "Course identity could not be created. The filename or document content may already exist.",
        error,
      );
    }

    let parsedDocument: Awaited<
      ReturnType<PdfJsDocumentParser["parse"]>
    >;
    let extractedPdfData: ReturnType<PdfJsDocumentParser["toExtractedPdfData"]>;

    try {
      const parsed = await this.dependencies.pdfParser.parseWithMetrics(
        request.document_bytes,
      );
      parsedDocument = parsed.document;
      extractedPdfData =
        this.dependencies.pdfParser.toExtractedPdfData(parsedDocument);
    } catch (error) {
      throw new CourseCreationStageError(
        "pdf_parsing",
        "The uploaded file could not be parsed as a PDF.",
        error,
      );
    }

    const validation = this.dependencies.validator.validate(extractedPdfData);
    if (!validation.isValid()) {
      throw new CourseCreationStageError(
        "validation",
        "The PDF was rejected by the existing validation pipeline.",
        {
          configuration_valid: validation.configuration_valid,
          issues: validation.issues,
        },
      );
    }

    let material: ExtractionResult;
    try {
      material =
        this.dependencies.extractor.extractParsedDocument(parsedDocument);
    } catch (error) {
      throw new CourseCreationStageError(
        "extraction",
        "Document hierarchy extraction failed.",
        error,
      );
    }

    if (!material.is_successful) {
      throw new CourseCreationStageError(
        "extraction",
        material.error || "Document hierarchy extraction was unsuccessful.",
        material,
      );
    }

    let tokenizer: Pick<BgeM3Tokenizer, "countTokens">;
    try {
      tokenizer = await this.getTokenizer();
    } catch (error) {
      throw new CourseCreationStageError(
        "chunking",
        "The BGE-M3 tokenizer could not be loaded.",
        error,
      );
    }

    const chunking = new ChunkerService(
      this.dependencies.config,
      (text) => tokenizer.countTokens(text),
    ).chunkDocument(material);

    if (!chunking.is_successful) {
      throw new CourseCreationStageError(
        "chunking",
        chunking.error || "Document chunking failed.",
        chunking,
      );
    }

    if (chunking.chunks.length === 0) {
      throw new CourseCreationStageError(
        "chunking",
        "The extracted document produced no searchable chunks.",
        chunking,
      );
    }

    let embeddingService: Pick<EmbeddingService, "embedTexts">;
    try {
      embeddingService = await this.getEmbedder();
    } catch (error) {
      throw new CourseCreationStageError(
        "embedding",
        "The BGE-M3 embedding model could not be loaded.",
        error,
      );
    }

    let embeddings: EmbeddingResult;
    try {
      embeddings = await embeddingService.embedTexts(
        chunking.chunks.map((chunk) => chunk.embedding_text),
      );
    } catch (error) {
      throw new CourseCreationStageError(
        "embedding",
        "Generating document embeddings failed.",
        error,
      );
    }

    if (embeddings.embeddings.length !== chunking.chunks.length) {
      throw new CourseCreationStageError(
        "embedding",
        `Embedding count mismatch: received ${embeddings.embeddings.length} vectors for ${chunking.chunks.length} chunks.`,
        embeddings,
      );
    }

    if (
      embeddings.dimensions !== 1024 ||
      embeddings.embeddings.some(
        (vector) =>
          vector.length !== embeddings.dimensions ||
          vector.some((value) => !Number.isFinite(value)),
      )
    ) {
      throw new CourseCreationStageError(
        "embedding",
        "The embedding model returned vectors with invalid dimensions or values.",
        embeddings,
      );
    }

    return {
      identity,
      validation,
      material,
      chunks: chunking.chunks,
      embeddings,
      page_count: parsedDocument.pages.length,
    };
  }

  private getTokenizer(): Promise<Pick<BgeM3Tokenizer, "countTokens">> {
    if (!this.tokenizerPromise) {
      const pending = this.dependencies.loadTokenizer();
      this.tokenizerPromise = pending;
      void pending.catch(() => {
        if (this.tokenizerPromise === pending) {
          this.tokenizerPromise = undefined;
        }
      });
    }
    return this.tokenizerPromise;
  }

  private getEmbedder(): Promise<Pick<EmbeddingService, "embedTexts">> {
    if (!this.embedderPromise) {
      const pending = this.dependencies.loadEmbedder();
      this.embedderPromise = pending;
      void pending.catch(() => {
        if (this.embedderPromise === pending) {
          this.embedderPromise = undefined;
        }
      });
    }
    return this.embedderPromise;
  }
}
