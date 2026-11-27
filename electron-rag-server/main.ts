import express, { type Request, type Response } from "express";
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
  servers: [{ url: "http://localhost:3000" }],
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
          "Parses the uploaded PDF with PDF.js and returns page count and extracted page text. This is a parser smoke-test endpoint; it does not yet run Validator, Extractor hierarchy construction, or Chunker.",
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

    const fileBytes = new Uint8Array(
      request.file.buffer.buffer,
      request.file.buffer.byteOffset,
      request.file.buffer.byteLength,
    );

    let pdfDocument: Awaited<ReturnType<ReturnType<typeof getDocument>["promise"]>> | undefined;

    try {
      const loadingTask = getDocument({ data: fileBytes });
      pdfDocument = await loadingTask.promise;

      const pages: Array<{ page_number: number; text: string }> = [];

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

      response.status(200).json({
        file_name: request.file.originalname,
        file_size_bytes: request.file.size,
        page_count: pdfDocument.numPages,
        pages,
      });
    } catch (error) {
      response.status(400).json({
        error: "Unable to parse the uploaded file as a valid PDF.",
        details: error instanceof Error ? error.message : "Unknown PDF parsing error.",
      });
    } finally {
      if (pdfDocument) {
        await pdfDocument.destroy();
      }
    }
  },
);

app.use((error: unknown, _request: Request, response: Response, _next: express.NextFunction) => {
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
