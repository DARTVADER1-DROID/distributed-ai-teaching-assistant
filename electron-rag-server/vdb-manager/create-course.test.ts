import assert from "node:assert/strict";
import { RagConfig } from "../config/config.js";
import {
  DocumentNodeType,
  type ExtractionResult,
  type ParsedPdfDocument,
} from "../extractor/extractor-service.js";
import { ValidationReport } from "../validator/font-size-validator.js";
import { CreateCourse, CourseCreationStageError } from "./create-course.js";

const parsedDocument: ParsedPdfDocument = {
  is_locked: false,
  pages: [{
    text_boxes: [{
      text: "A valid heading and body paragraph.",
      top: 10,
      bottom: 20,
      height: 10,
      font_size: 24,
    }],
  }],
};

const extraction: ExtractionResult = {
  is_successful: true,
  error: "",
  document: {
    type: DocumentNodeType.Document,
    heading_level: 0,
    text: "",
    page_number: 0,
    line_number: 0,
    end_page_number: 0,
    page_count: 1,
    end_line_number: 0,
    children: [{
      type: DocumentNodeType.Paragraph,
      heading_level: 0,
      text: "A valid heading and body paragraph.",
      page_number: 1,
      line_number: 1,
      end_page_number: 1,
      page_count: 1,
      end_line_number: 1,
      children: [],
    }],
  },
};

async function runCreateCoursePipelineTest(): Promise<void> {
  let extractionCalls = 0;
  let tokenizerLoads = 0;
  let embedderLoads = 0;
  let embeddingInputs: string[] = [];

  const validReport = new ValidationReport();
  const dependencies = {
    identityFactory: {
      async createIdentity() {
        return {
          course_id: "7a1a3a84-3fd7-4d75-a75d-6adca39b7f8d",
          document_name: "sample.pdf",
          document_name_key: "sample.pdf",
          document_hash: "a".repeat(64),
        };
      },
    },
    pdfParser: {
      async parseWithMetrics() {
        return {
          document: parsedDocument,
          pdf_loading_ms: 1,
          page_text_extraction_ms: 1,
        };
      },
      toExtractedPdfData() {
        return {
          page_count: 1,
          lines: [{
            page_number: 1,
            line_number: 1,
            text: "A valid heading and body paragraph.",
            word_count: 6,
            font_sizes: [24],
          }],
          ordered_font_sizes: [24],
          font_size_frequency: new Map([[24, 1]]),
          body_font_size: 24,
        };
      },
    },
    validator: {
      validate() {
        return validReport;
      },
    },
    extractor: {
      extractParsedDocument() {
        extractionCalls += 1;
        return extraction;
      },
    },
    config: new RagConfig(),
    async loadTokenizer() {
      tokenizerLoads += 1;
      return { countTokens: (value: string) => value.trim().split(/\s+/).length };
    },
    async loadEmbedder() {
      embedderLoads += 1;
      return {
        async embedTexts(texts: string[]) {
          embeddingInputs = texts;
          return {
            model_id: "test-model",
            dimensions: 1024,
            embeddings: texts.map(() => Array.from({ length: 1024 }, () => 0.01)),
          };
        },
      };
    },
  };

  const courseCreator = new CreateCourse(dependencies);
  const request = {
    document_name: "sample.pdf",
    document_bytes: new TextEncoder().encode("%PDF-test"),
  };

  const first = await courseCreator.execute(request);
  const second = await courseCreator.execute(request);

  assert.equal(first.chunks.length, 1);
  assert.equal(first.embeddings.embeddings.length, 1);
  assert.equal(first.identity.course_id, second.identity.course_id);
  assert.equal(embeddingInputs.length, 1);
  assert.equal(tokenizerLoads, 1);
  assert.equal(embedderLoads, 1);
  assert.equal(extractionCalls, 2);

  const invalidReport = new ValidationReport();
  invalidReport.addIssue({ reason: "Invalid heading size." });
  const invalidCreator = new CreateCourse({
    ...dependencies,
    validator: { validate: () => invalidReport },
    extractor: {
      extractParsedDocument() {
        throw new Error("Extractor must not run for an invalid PDF.");
      },
    },
  });

  await assert.rejects(
    invalidCreator.execute(request),
    (error: unknown) =>
      error instanceof CourseCreationStageError &&
      error.stage === "validation" &&
      typeof error.details === "object",
  );

  console.log(
    "CreateCourse pipeline test passed: validation gates extraction, chunking uses the loaded tokenizer, embeddings match chunk count, and model instances are cached.",
  );
}

await runCreateCoursePipelineTest();
