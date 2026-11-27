/**
 * PDF.js adapter for the RAG pipeline.
 *
 * Converts PDF.js text items into the library-independent ParsedPdfDocument
 * model consumed by ExtractorService, and into ExtractedPdfData consumed by
 * ValidatorService. Coordinates are normalized to a top-left origin in PDF
 * points; font sizes are recovered from each text item's transform matrix.
 */

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { RagConfig } from "../config/config.js";
import type {
  ParsedPdfDocument,
  ParsedPdfPage,
  PdfDocumentParser,
  PdfTextBox,
} from "../extractor/extractor-service.js";
import type {
  ExtractedPdfData,
  ExtractedPdfLine,
} from "../validator/font-size-validator.js";

interface PdfJsTextItem {
  str?: string;
  transform?: number[];
  width?: number;
  height?: number;
  fontName?: string;
  hasEOL?: boolean;
}

interface PdfJsTextStyle {
  ascent?: number;
  descent?: number;
}

interface PdfJsTextContent {
  items: unknown[];
  styles: Record<string, PdfJsTextStyle>;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) ? value : fallback;
}

function fontSizeFromTransform(transform: number[] | undefined): number | undefined {
  if (!transform || transform.length < 4) {
    return undefined;
  }

  // PDF.js text matrices are [a, b, c, d, e, f]. The second column
  // describes the glyph's vertical scale for ordinary horizontal text.
  const verticalScale = Math.hypot(transform[2] ?? 0, transform[3] ?? 0);
  const horizontalScale = Math.hypot(transform[0] ?? 0, transform[1] ?? 0);
  const size = verticalScale > 0 ? verticalScale : horizontalScale;

  return Number.isFinite(size) && size > 0 ? size : undefined;
}

function textBoxFromItem(
  item: PdfJsTextItem,
  styles: Record<string, PdfJsTextStyle>,
  pageHeight: number,
): PdfTextBox | undefined {
  const text = item.str ?? "";
  const transform = item.transform;

  if (text.length === 0 || !transform || transform.length < 6) {
    return undefined;
  }

  const fontSize = fontSizeFromTransform(transform);
  const baseline = finiteOr(transform[5], 0);
  const style = item.fontName ? styles[item.fontName] : undefined;
  const ascent = finiteOr(style?.ascent, 1);
  const descent = finiteOr(style?.descent, 0);

  // PDF user space has its origin at the bottom-left. ExtractorService
  // expects top/bottom coordinates increasing down the page.
  const glyphTop = pageHeight - (baseline + ascent * (fontSize ?? 0));
  const glyphBottom = pageHeight - (baseline + descent * (fontSize ?? 0));
  const reportedHeight = Math.abs(finiteOr(item.height, 0));
  const geometryHeight = Math.abs(glyphBottom - glyphTop);
  const height = Math.max(1, geometryHeight, reportedHeight);
  const top = Math.min(glyphTop, glyphBottom);
  const bottom = Math.max(glyphTop, glyphBottom);

  return {
    text,
    top,
    bottom: Math.max(bottom, top + height),
    height,
    ...(fontSize === undefined ? {} : { font_size: fontSize }),
    ...(item.hasEOL ? { ends_line: true } : {}),
  };
}

function appendText(current: string, fragment: string): string {
  if (
    current.length > 0 &&
    !/[\\s]$/.test(current) &&
    !/^[\\s]/.test(fragment)
  ) {
    return current + " " + fragment;
  }
  return current + fragment;
}

interface MutableLine {
  page_number: number;
  line_number: number;
  text: string;
  word_count: number;
  font_sizes: number[];
  center: number;
  height: number;
  fragment_count: number;
}

function belongsToLine(box: PdfTextBox, line: MutableLine): boolean {
  const center = box.top + box.height / 2;
  const tolerance = Math.max(2, Math.min(box.height, line.height) * 0.5);
  return Math.abs(center - line.center) <= tolerance;
}

export class PdfJsDocumentParser implements PdfDocumentParser {
  private readonly config: RagConfig;

  public constructor(config: Partial<RagConfig> = {}) {
    this.config = new RagConfig(config);
  }

  public async parse(pdfData: Uint8Array): Promise<ParsedPdfDocument> {
    if (pdfData.byteLength === 0) {
      throw new Error("PDF data is empty.");
    }

    const loadingTask = getDocument({ data: pdfData });
    try {
      const pdf = await loadingTask.promise;
      const pages: ParsedPdfPage[] = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        try {
          const viewport = page.getViewport({ scale: 1 });
          const content = (await page.getTextContent()) as unknown as PdfJsTextContent;
          const textBoxes: PdfTextBox[] = [];

          for (const rawItem of content.items) {
            const item = rawItem as PdfJsTextItem;
            const textBox = textBoxFromItem(item, content.styles, viewport.height);
            if (textBox) {
              textBoxes.push(textBox);
            }
          }

          pages.push({ text_boxes: textBoxes });
        } finally {
          page.cleanup();
        }
      }

      return { is_locked: false, pages };
    } finally {
      await loadingTask.destroy();
    }
  }

  /**
   * Converts parsed PDF text boxes into the exact validator input contract.
   * Font frequency counts text items (not characters or words), matching the
   * extractor's document-wide dominant-font calculation.
   */
  public toExtractedPdfData(document: ParsedPdfDocument): ExtractedPdfData {
    const precisionScale = Math.pow(
      10,
      this.config.font_size_precision_decimal_places,
    );
    const fontFrequency = new Map<number, number>();
    const lines: MutableLine[] = [];

    for (let pageIndex = 0; pageIndex < document.pages.length; pageIndex += 1) {
      const page = document.pages[pageIndex];
      if (!page) {
        continue;
      }

      let pageLineNumber = 0;
      let currentLine: MutableLine | undefined;

      for (const box of page.text_boxes) {
        if (box.text.length === 0) {
          continue;
        }

        const startsNewLine =
          !currentLine ||
          (currentLine as MutableLine & { force_next_line?: boolean }).force_next_line === true ||
          !belongsToLine(box, currentLine);

        if (startsNewLine) {
          pageLineNumber += 1;
          currentLine = {
            page_number: pageIndex + 1,
            line_number: pageLineNumber,
            text: "",
            word_count: 0,
            font_sizes: [],
            center: box.top + box.height / 2,
            height: Math.max(1, box.height),
            fragment_count: 0,
          };
          lines.push(currentLine);
        } else {
          const weight = currentLine.fragment_count;
          currentLine.center =
            (currentLine.center * weight + box.top + box.height / 2) /
            (weight + 1);
          currentLine.height = Math.max(currentLine.height, box.height);
        }

        currentLine.text = appendText(currentLine.text, box.text);
        currentLine.fragment_count += 1;

        if (
          box.font_size !== undefined &&
          Number.isFinite(box.font_size) &&
          box.font_size > 0
        ) {
          const normalized =
            Math.round(box.font_size * precisionScale) / precisionScale;
          currentLine.font_sizes.push(normalized);
          fontFrequency.set(
            normalized,
            (fontFrequency.get(normalized) ?? 0) + 1,
          );
        }

        (currentLine as MutableLine & { force_next_line?: boolean }).force_next_line =
          (box as PdfTextBox & { ends_line?: boolean }).ends_line === true;
      }
    }

    const extractedLines: ExtractedPdfLine[] = lines.map((line) => {
      const text = line.text.trim();
      return {
        page_number: line.page_number,
        line_number: line.line_number,
        text,
        word_count: text.length === 0 ? 0 : text.split(/\\s+/).length,
        font_sizes: line.font_sizes,
      };
    });

    let bodyFontSize = 0;
    let highestFrequency = 0;
    for (const [fontSize, frequency] of fontFrequency) {
      if (frequency > highestFrequency) {
        bodyFontSize = fontSize;
        highestFrequency = frequency;
      }
    }

    return {
      page_count: document.pages.length,
      lines: extractedLines,
      ordered_font_sizes: Array.from(fontFrequency.keys()).sort(
        (left, right) => left - right,
      ),
      font_size_frequency: fontFrequency,
      body_font_size: bodyFontSize,
    };
  }

  public getPageText(document: ParsedPdfDocument): Array<{
    page_number: number;
    text: string;
  }> {
    return document.pages.map((page, index) => ({
      page_number: index + 1,
      text: page.text_boxes.map((box) => box.text).filter(Boolean).join(" "),
    }));
  }
}
