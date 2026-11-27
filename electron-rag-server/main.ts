import express, { type NextFunction, type Request, type Response } from "express";
import { performance } from "node:perf_hooks";
import multer from "multer";
import swaggerUi from "swagger-ui-express";
import { RagConfig } from "./config/config.js";
import { PdfJsDocumentParser } from "./pdf/pdfjs-document-parser.js";
import { ValidatorService } from "./validator/validator-service.js";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

const ragConfig = new RagConfig();
const pdfParser = new PdfJsDocumentParser(ragConfig);
const validator = new ValidatorService(ragConfig);

app.use(express.json());

const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Electron RAG Server API",
    version: "1.0.0",
    description:
      "Upload a PDF, extract text and font geometry with PDF.js, and run the configured RAG document validators.",
  },
  servers: [{ url: "/" }],
  paths: {
    "/health": {
      get: {
        summary: "Check server health",
        responses: {
          "200": {
            description: "Server is running",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/api/pdf/inspect": {
      post: {
        summary: "Parse and validate a PDF",
        description:
          "Parses PDF text and font geometry with PDF.js, converts it to ExtractedPdfData, and runs ValidatorService. Hierarchy extraction and chunking remain separate pipeline stages.",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: {
                  file: { type: "string", format: "binary", description: "PDF file (maximum 25 MB)" },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "PDF parsed and validation completed",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "400": { description: "Missing or invalid PDF" },
          "413": { description: "PDF exceeds the upload limit" },
          "500": { description: "PDF processing failed" },
        },
      },
    },
  },
};

app.get("/health", (_request: Request, response: Response) => {
  response.status(200).json({ status: "ok" });
});

app.get("/openapi.json", (_request: Request, response: Response) => {
  response.json(openApiDocument);
});

app.use("/docs", swaggerUi.serve, swaggerUi.setup(openApiDocument));

app.post(
  "/api/pdf/inspect",
  upload.single("file"),
  async (request: Request, response: Response) => {
    if (!request.file) {
      response.status(400).json({ error: "Upload a PDF using the 'file' field." });
      return;
    }

    const requestStartedAt = performance.now();
    const fileBytes = new Uint8Array(
      request.file.buffer.buffer,
      request.file.buffer.byteOffset,
      request.file.buffer.byteLength,
    );

    try {
      const parsed = await pdfParser.parseWithMetrics(fileBytes);
      const extractedPdfData = pdfParser.toExtractedPdfData(parsed.document);
      const pages = pdfParser.getPageText(parsed.document);

      const validationStartedAt = performance.now();
      const validationReport = validator.validate(extractedPdfData);
      const validationDurationMs = performance.now() - validationStartedAt;
      const fontSizeFrequency =
        extractedPdfData.font_size_frequency instanceof Map
          ? Object.fromEntries(extractedPdfData.font_size_frequency)
          : extractedPdfData.font_size_frequency;

      const totalDurationMs = performance.now() - requestStartedAt;
      const totalDurationSeconds = totalDurationMs / 1000;
      const pipelineStages = [
        {
          stage: "pdf_loading",
          status: "completed",
          duration_ms: Number(parsed.pdf_loading_ms.toFixed(3)),
        },
        {
          stage: "page_text_extraction",
          status: "completed",
          duration_ms: Number(parsed.page_text_extraction_ms.toFixed(3)),
          pages_processed: pages.length,
          text_boxes_processed: parsed.document.pages.reduce(
            (total, page) => total + page.text_boxes.length,
            0,
          ),
        },
        {
          stage: "validation",
          status: "completed",
          duration_ms: Number(validationDurationMs.toFixed(3)),
          is_valid: validationReport.isValid(),
          issue_count: validationReport.issues.length,
        },
        {
          stage: "hierarchy_extraction",
          status: "not_connected",
          duration_ms: null,
          reason: "The parsed PDF is not yet passed through ExtractorService.",
        },
        {
          stage: "chunking",
          status: "not_connected",
          duration_ms: null,
          reason: "ChunkerService still requires the exact tokenizer selected for the embedding model.",
        },
      ];

      response.status(200).json({
        file_name: request.file.originalname,
        file_size_bytes: request.file.size,
        page_count: parsed.document.pages.length,
        pages,
        validation: {
          is_valid: validationReport.isValid(),
          configuration_valid: validationReport.configuration_valid,
          issue_count: validationReport.issues.length,
          issues: validationReport.issues,
          extracted_data: {
            line_count: extractedPdfData.lines.length,
            ordered_font_sizes: extractedPdfData.ordered_font_sizes,
            font_size_frequency: fontSizeFrequency,
            body_font_size: extractedPdfData.body_font_size,
          },
        },
        performance: {
          total_duration_ms: Number(totalDurationMs.toFixed(3)),
          stages: pipelineStages,
          throughput: {
            pages_per_second:
              totalDurationSeconds > 0
                ? Number((parsed.document.pages.length / totalDurationSeconds).toFixed(2))
                : null,
            input_megabytes_per_second:
              totalDurationSeconds > 0
                ? Number((request.file.size / 1024 / 1024 / totalDurationSeconds).toFixed(2))
                : null,
          },
        },
      });
    } catch (error) {
      response.status(400).json({
        error: "Unable to parse or validate the uploaded PDF.",
        details: error instanceof Error ? error.message : "Unknown PDF processing error.",
      });
    }
  },
);

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    response.status(413).json({ error: "PDF exceeds the 25 MB upload limit." });
    return;
  }

  response.status(400).json({
    error: error instanceof Error ? error.message : "Request failed.",
  });
});

app.listen(port, () => {
  console.log(`Electron RAG test API listening on http://localhost:${port}`);
  console.log(`Swagger UI: http://localhost:${port}/docs`);
});
