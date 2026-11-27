import express, { type NextFunction, type Request, type Response } from "express";
import { performance } from "node:perf_hooks";
import multer from "multer";
import swaggerUi from "swagger-ui-express";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const app = express();
const port = Number(process.env.PORT ?? 3000);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

app.use(express.json());

const openApiDocument = {
  openapi: "3.0.3",
  info: {
    title: "Electron RAG Server API",
    version: "1.0.0",
    description: "Local development API for uploading and inspecting PDF documents.",
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
        summary: "Upload and inspect a PDF",
        description:
          "Parses the uploaded PDF with PDF.js and returns page count, extracted page text, and stage-level performance measurements. Validator, hierarchy extraction, and chunking are reported as not connected until their input adapters and tokenizer are configured.",
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
            description: "PDF parsed successfully",
            content: { "application/json": { schema: { type: "object" } } },
          },
          "400": { description: "Missing or invalid PDF" },
          "413": { description: "PDF exceeds the upload limit" },
          "500": { description: "PDF parsing failed" },
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

    let destroyPdf: (() => Promise<void>) | undefined;
    let pdfLoadingMs = 0;
    let pageTextExtractionMs = 0;

    try {
      const pdfLoadingStartedAt = performance.now();
      const loadingTask = getDocument({ data: fileBytes });
      const pdfDocument = await loadingTask.promise;
      pdfLoadingMs = performance.now() - pdfLoadingStartedAt;
      destroyPdf = () => loadingTask.destroy();

      const pages: Array<{ page_number: number; text: string }> = [];
      const pageTextExtractionStartedAt = performance.now();

      for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
        const page = await pdfDocument.getPage(pageNumber);
        const textContent = await page.getTextContent();
        const text = textContent.items
          .map((item) => ("str" in item ? item.str : ""))
          .filter(Boolean)
          .join(" ");

        pages.push({ page_number: pageNumber, text });
        page.cleanup();
      }
      pageTextExtractionMs = performance.now() - pageTextExtractionStartedAt;

      const totalDurationMs = performance.now() - requestStartedAt;
      const totalDurationSeconds = totalDurationMs / 1000;
      const pipelineStages = [
        {
          stage: "pdf_loading",
          status: "completed",
          duration_ms: Number(pdfLoadingMs.toFixed(3)),
        },
        {
          stage: "page_text_extraction",
          status: "completed",
          duration_ms: Number(pageTextExtractionMs.toFixed(3)),
          pages_processed: pages.length,
        },
        {
          stage: "validation",
          status: "not_connected",
          duration_ms: null,
          reason: "The PDF.js-to-ExtractedPdfData adapter is not implemented yet.",
        },
        {
          stage: "hierarchy_extraction",
          status: "not_connected",
          duration_ms: null,
          reason: "The PDF.js parser adapter is not wired into ExtractorService yet.",
        },
        {
          stage: "chunking",
          status: "not_connected",
          duration_ms: null,
          reason: "ChunkerService requires an explicitly selected embedding-model tokenizer.",
        },
      ];

      response.status(200).json({
        file_name: request.file.originalname,
        file_size_bytes: request.file.size,
        page_count: pdfDocument.numPages,
        pages,
        performance: {
          total_duration_ms: Number(totalDurationMs.toFixed(3)),
          stages: pipelineStages,
          throughput: {
            pages_per_second:
              totalDurationSeconds > 0
                ? Number((pdfDocument.numPages / totalDurationSeconds).toFixed(2))
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
        error: "Unable to parse the uploaded file as a valid PDF.",
        details: error instanceof Error ? error.message : "Unknown PDF parsing error.",
      });
    } finally {
      if (destroyPdf) {
        await destroyPdf();
      }
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
