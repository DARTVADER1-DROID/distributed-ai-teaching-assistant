import express, { type ErrorRequestHandler, type Request } from "express";
import multer from "multer";
import swaggerUi from "swagger-ui-express";
import { connect } from "@lancedb/lancedb";
import { RagConfig } from "./config/config.js";
import { PdfJsDocumentParser } from "./pdf/pdfjs-document-parser.js";
import { ExtractorService } from "./extractor/extractor-service.js";
import { ValidatorService } from "./validator/validator-service.js";
import { BgeM3Tokenizer } from "./embedding/bge-m3-tokenizer.js";
import { EmbeddingService } from "./embedding/embedding-service.js";
import { CourseTableManager } from "./vdb-manager/course-table-manager.js";
import { CourseDuplicateChecker } from "./vdb-manager/course-duplicate-checker.js";
import { CourseIdentityFactory } from "./vdb-manager/course-identity-factory.js";
import { CourseRepository } from "./vdb-manager/course-repository.js";
import { CreateCourse, CourseCreationStageError } from "./vdb-manager/create-course.js";
import { CourseDuplicateError } from "./vdb-manager/course-duplicate-error.js";
import { VdbManagerService } from "./vdb-manager/vdb-manager-service.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});
app.use(express.json({ limit: "2mb" }));

const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "Electron RAG Server API",
    version: "1.0.0",
    description: "Course catalogue lifecycle API. PDF uploads are validated, hierarchically extracted, chunked and embedded before persistence.",
  },
  servers: [{ url: "/" }],
  tags: [
    { name: "Health", description: "Service availability." },
    { name: "Courses", description: "Create PDF-backed courses and list the stored course catalogue." },
  ],
  components: {
    schemas: {
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: { type: "string" },
          details: {},
        },
      },
      DocumentNode: {
        type: "object",
        required: ["type", "heading_level", "text", "page_number", "line_number", "end_page_number", "page_count", "end_line_number", "children"],
        properties: {
          type: { type: "string", enum: ["Document", "Heading", "Paragraph"] },
          heading_level: { type: "integer", minimum: 0, maximum: 6 },
          text: { type: "string" },
          page_number: { type: "integer", minimum: 0 },
          line_number: { type: "integer", minimum: 0 },
          end_page_number: { type: "integer", minimum: 0 },
          page_count: { type: "integer", minimum: 0 },
          end_line_number: { type: "integer", minimum: 0 },
          children: { type: "array", items: { $ref: "#/components/schemas/DocumentNode" } },
        },
      },
      ExtractionResult: {
        type: "object",
        required: ["is_successful", "error", "document"],
        properties: {
          is_successful: { type: "boolean" },
          error: { type: "string" },
          document: { $ref: "#/components/schemas/DocumentNode" },
        },
      },
      Course: {
        type: "object",
        required: ["course_id", "document_name", "document_hash", "material"],
        properties: {
          course_id: { type: "string", format: "uuid" },
          document_name: { type: "string" },
          document_hash: { type: "string", pattern: "^[a-f0-9]{64}$" },
          material: { $ref: "#/components/schemas/ExtractionResult" },
        },
      },
      EmbeddingOutput: {
        type: "object",
        required: ["model_id", "dimensions", "vector_count", "sample_vector"],
        properties: {
          model_id: { type: "string" },
          dimensions: { type: "integer", const: 1024 },
          vector_count: { type: "integer" },
          sample_vector: {
            type: "array",
            items: { type: "number" },
            minItems: 1024,
            maxItems: 1024,
            description: "The complete vector generated for the first chunk, useful for inspecting the embedding output.",
          },
        },
      },
      CourseProcessingResult: {
        type: "object",
        required: ["course_id", "document_name", "page_count", "chunk_count", "embedding_output"],
        properties: {
          course_id: { type: "string", format: "uuid" },
          document_name: { type: "string" },
          page_count: { type: "integer" },
          chunk_count: { type: "integer" },
          embedding_output: { $ref: "#/components/schemas/EmbeddingOutput" },
        },
      },
    },
    requestBodies: {
      PdfUpload: {
        required: true,
        content: {
          "multipart/form-data": {
            schema: {
              type: "object",
              required: ["file"],
              properties: {
                file: { type: "string", format: "binary", description: "PDF document, maximum 25 MB." },
              },
            },
            encoding: {
              file: { contentType: "application/pdf" },
            },
          },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        tags: ["Health"],
        summary: "Health check",
        operationId: "getHealth",
        responses: {
          "200": {
            description: "Service is ready.",
            content: { "application/json": { schema: { type: "object", properties: { status: { type: "string", const: "ok" } } } } },
          },
        },
      },
    },
    "/api/courses": {
      post: {
        tags: ["Courses"],
        summary: "Create a course from a PDF",
        operationId: "createCourse",
        requestBody: { $ref: "#/components/requestBodies/PdfUpload" },
        responses: {
          "201": { description: "Course processed, embedded and persisted.", content: { "application/json": { schema: { $ref: "#/components/schemas/CourseProcessingResult" } } } },
          "400": { description: "Missing PDF upload or malformed request.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "409": { description: "Duplicate filename or document content.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "413": { description: "Upload exceeds 25 MB." },
          "422": { description: "PDF validation, extraction, chunking or embedding failed.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
          "500": { description: "Unexpected server or persistence error.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
        },
      },
      get: {
        tags: ["Courses"],
        summary: "List all courses",
        operationId: "listCourses",
        responses: {
          "200": {
            description: "Stored courses.",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Course" },
                },
              },
            },
          },
        },
      },
    },
  },
};

function processingResponse(result: Awaited<ReturnType<VdbManagerService["createCourse"]>>) {
  const sampleVector = result.embeddings.embeddings[0] ?? [];
  return {
    course_id: result.identity.course_id,
    document_name: result.identity.document_name,
    page_count: result.page_count,
    chunk_count: result.chunks.length,
    embedding_output: {
      model_id: result.embeddings.model_id,
      dimensions: result.embeddings.dimensions,
      vector_count: result.embeddings.embeddings.length,
      sample_vector: sampleVector,
    },
  };
}

function uploadRequest(request: Request): { document_name: string; document_bytes: Uint8Array } {
  if (!request.file) {
    throw new HttpInputError("Upload a PDF using the 'file' field.");
  }
  return {
    document_name: request.file.originalname,
    document_bytes: new Uint8Array(
      request.file.buffer.buffer,
      request.file.buffer.byteOffset,
      request.file.buffer.byteLength,
    ),
  };
}

class HttpInputError extends Error {}

function installRoutes(vdbManager: VdbManagerService): void {
  app.get("/health", (_request, response) => response.status(200).json({ status: "ok" }));
  app.get("/openapi.json", (_request, response) => response.json(openApiDocument));
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument, {
    explorer: true,
    swaggerOptions: { persistAuthorization: false, displayRequestDuration: true },
  }));

  app.post("/api/courses", upload.single("file"), async (request, response, next) => {
    try {
      const result = await vdbManager.createCourse(uploadRequest(request));
      response.status(201).json(processingResponse(result));
    } catch (error) { next(error); }
  });

  app.get("/api/courses", async (_request, response, next) => {
    try { response.status(200).json(await vdbManager.getAllCourses()); }
    catch (error) { next(error); }
  });

  const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      response.status(413).json({ error: "PDF exceeds the 25 MB upload limit." });
      return;
    }
    if (error instanceof CourseDuplicateError) {
      response.status(409).json({ error: error.message, reason: error.reason });
      return;
    }
    if (error instanceof CourseCreationStageError) {
      const status = error.stage === "identity" ? 409 : 422;
      response.status(status).json({
        error: error.message,
        stage: error.stage,
        details: error.details instanceof Error ? error.details.message : error.details,
      });
      return;
    }
    if (error instanceof HttpInputError) {
      response.status(400).json({ error: error.message });
      return;
    }
    console.error("Unhandled request error:", error);
    response.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error.",
    });
  };
  app.use(errorHandler);
}

async function main(): Promise<void> {
  const config = new RagConfig();
  const connection = await connect(process.env.LANCEDB_URI ?? "./data/lancedb");
  const tables = await new CourseTableManager(connection).ensureTables();
  const repository = new CourseRepository(tables.courses, tables.courseChunks);
  const identityFactory = new CourseIdentityFactory(new CourseDuplicateChecker(tables.courses));
  const pdfParser = new PdfJsDocumentParser(config);

  const pipeline = new CreateCourse({
    identityFactory,
    pdfParser,
    validator: new ValidatorService(config),
    extractor: new ExtractorService(pdfParser, config),
    config,
    loadTokenizer: () => BgeM3Tokenizer.load(),
    loadEmbedder: () => EmbeddingService.load(),
  });

  const vdbManager = new VdbManagerService(pipeline, repository);
  installRoutes(vdbManager);

  const server = app.listen(port, () => {
    console.log(`Electron RAG VDB manager listening on http://localhost:${port}`);
    console.log(`OpenAPI document: http://localhost:${port}/openapi.json`);
    console.log(`Swagger UI: http://localhost:${port}/docs`);
    console.log(`LanceDB: ${process.env.LANCEDB_URI ?? "./data/lancedb"}`);
  });

  const shutdown = (): void => {
    server.close(() => {
      connection.close();
      process.exit(0);
    });
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

void main().catch((error: unknown) => {
  console.error("Failed to start Electron RAG VDB manager:", error);
  process.exitCode = 1;
});
