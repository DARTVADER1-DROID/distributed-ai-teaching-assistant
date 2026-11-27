/**
 * TypeScript document extraction service.
 *
 * Reconstructs a navigable document hierarchy from PDF text, font metadata,
 * and line geometry. PDF decoding is supplied through PdfDocumentParser so
 * the extraction logic remains independent of a particular PDF library.
 */

import { RagConfig } from "../config/config.js";

export enum DocumentNodeType {
  Document = "Document",
  Heading = "Heading",
  Paragraph = "Paragraph",
}

export interface DocumentNode {
  type: DocumentNodeType;
  heading_level: number;
  text: string;
  page_number: number;
  line_number: number;
  end_page_number: number;
  page_count: number;
  end_line_number: number;
  children: DocumentNode[];
}

export interface ExtractionResult {
  is_successful: boolean;
  error: string;
  document: DocumentNode;
}

/** One text fragment and its PDF-space bounding box. */
export interface PdfTextBox {
  text: string;
  top: number;
  bottom: number;
  height: number;
  font_size?: number;
  /** PDF.js line-ending hint; ignored by hierarchy extraction itself. */
  ends_line?: boolean;
}

export interface ParsedPdfPage {
  text_boxes: PdfTextBox[];
}

export interface ParsedPdfDocument {
  is_locked: boolean;
  pages: ParsedPdfPage[];
}

/**
 * Adapter boundary for a PDF library (for example, PDF.js).
 * Implementations must return text boxes in the PDF page's reading order and
 * preserve font sizes in PDF points and vertical coordinates in page space.
 */
export interface PdfDocumentParser {
  parse(pdfData: Uint8Array): Promise<ParsedPdfDocument>;
}

interface ExtractedLine {
  page_number: number;
  line_number: number;
  text: string;
  font_sizes: number[];
  top: number;
  bottom: number;
  height: number;
}

interface HeadingFrame {
  level: number;
  path: number[];
}

interface ParagraphFrame {
  active: boolean;
  parent_path: number[];
  child_index: number;
  page_number: number;
  previous_bottom: number;
  previous_height: number;
}

function createDocumentNode(): DocumentNode {
  return {
    type: DocumentNodeType.Document,
    heading_level: 0,
    text: "",
    page_number: 0,
    line_number: 0,
    end_page_number: 0,
    page_count: 0,
    end_line_number: 0,
    children: [],
  };
}

/**
 * Finalizes page-span metadata after the complete hierarchy is known.
 * A heading's scope can extend beyond its own heading line, so descendant
 * ranges must be included when calculating its end page and page count.
 */
function populatePageSpan(node: DocumentNode): {
  end_page_number: number;
  end_line_number: number;
} {
  let endPage = node.end_page_number || node.page_number;
  let endLine = node.end_line_number || node.line_number;

  for (const child of node.children) {
    const childSpan = populatePageSpan(child);
    if (childSpan.end_page_number > endPage) {
      endPage = childSpan.end_page_number;
      endLine = childSpan.end_line_number;
    }
  }

  if (node.type !== DocumentNodeType.Document) {
    node.end_page_number = endPage;
    node.end_line_number = endLine;
    node.page_count =
      node.page_number > 0 && endPage >= node.page_number
        ? endPage - node.page_number + 1
        : 0;
  }

  return {
    end_page_number: endPage,
    end_line_number: endLine,
  };
}

function trim(value: string): string {
  return value.replace(/^[ \\t\\r\\n]+|[ \\t\\r\\n]+$/g, "");
}

function nodeAtPath(root: DocumentNode, path: number[]): DocumentNode | undefined {
  let current = root;

  for (const index of path) {
    if (index < 0 || index >= current.children.length) {
      return undefined;
    }
    current = current.children[index];
  }

  return current;
}

function verticalCenter(box: PdfTextBox): number {
  return box.top + box.height / 2;
}

function belongsToLine(
  box: PdfTextBox,
  lineCenter: number,
  lineHeight: number,
): boolean {
  const center = verticalCenter(box);
  const tolerance = Math.max(2, Math.min(box.height, lineHeight) * 0.5);
  return Math.abs(center - lineCenter) <= tolerance;
}

function headingLevelForLine(
  line: ExtractedLine,
  bodyFontSize: number,
  config: RagConfig,
): number {
  let matchedLevel = 0;
  let largestHeadingSize = 0;
  const uniqueSizes = new Set(line.font_sizes);

  for (const fontSize of uniqueSizes) {
    if (fontSize <= bodyFontSize + config.body_font_size_tolerance_points) {
      continue;
    }

    let candidateLevel = 0;
    let smallestDifference = Number.POSITIVE_INFINITY;

    for (const [level, expectedSize] of config.heading_font_sizes) {
      const difference = Math.abs(fontSize - expectedSize);
      if (difference < smallestDifference) {
        smallestDifference = difference;
        candidateLevel = level;
      }
    }

    if (
      candidateLevel !== 0 &&
      smallestDifference <= config.heading_font_size_tolerance_points &&
      fontSize > largestHeadingSize
    ) {
      largestHeadingSize = fontSize;
      matchedLevel = candidateLevel;
    }
  }

  return matchedLevel;
}

function validConfig(config: RagConfig): boolean {
  if (
    config.heading_font_sizes.size === 0 ||
    !Number.isFinite(config.heading_font_size_tolerance_points) ||
    config.heading_font_size_tolerance_points < 0 ||
    !Number.isFinite(config.body_font_size_tolerance_points) ||
    config.body_font_size_tolerance_points < 0 ||
    !Number.isFinite(config.paragraph_font_size_tolerance_points) ||
    config.paragraph_font_size_tolerance_points < 0 ||
    config.font_size_precision_decimal_places < 0 ||
    config.font_size_precision_decimal_places > 6
  ) {
    return false;
  }

  for (const [level, size] of config.heading_font_sizes) {
    if (level < 1 || level > 6 || !Number.isFinite(size) || size <= 0) {
      return false;
    }
  }

  return true;
}

export class ExtractorService {
  private readonly config: RagConfig;
  private readonly parser: PdfDocumentParser;

  public constructor(
    parser: PdfDocumentParser,
    config: Partial<RagConfig> = {},
  ) {
    this.parser = parser;
    this.config = new RagConfig(config);
  }

  /**
   * Extracts a previously validated PDF from its raw bytes.
   * Validation remains the caller's responsibility.
   */
  public async extractPdf(pdfData: Uint8Array): Promise<ExtractionResult> {
    const result: ExtractionResult = {
      is_successful: false,
      error: "",
      document: createDocumentNode(),
    };

    if (!validConfig(this.config)) {
      result.error = "Document format configuration is invalid.";
      return result;
    }

    if (pdfData.byteLength === 0) {
      result.error = "PDF data is empty.";
      return result;
    }

    let pdf: ParsedPdfDocument;
    try {
      pdf = await this.parser.parse(pdfData);
    } catch {
      result.error = "Unable to parse input as a valid PDF document.";
      return result;
    }

    return this.extractParsedDocument(pdf);
  }

  /**
   * Builds the document hierarchy from an already parsed PDF.
   * This lets the pipeline reuse PDF.js output without parsing the same bytes twice.
   */
  public extractParsedDocument(pdf: ParsedPdfDocument): ExtractionResult {
    const result: ExtractionResult = {
      is_successful: false,
      error: "",
      document: createDocumentNode(),
    };

    if (!validConfig(this.config)) {
      result.error = "Document format configuration is invalid.";
      return result;
    }

    if (pdf.is_locked) {
      result.error = "PDF is encrypted or password-protected.";
      return result;
    }

    if (pdf.pages.length === 0) {
      result.error = "PDF contains no pages.";
      return result;
    }

    result.document.page_count = pdf.pages.length;

    const precisionScale = Math.pow(
      10,
      this.config.font_size_precision_decimal_places,
    );
    const fontFrequency = new Map<number, number>();
    const lines: ExtractedLine[] = [];

    for (let pageIndex = 0; pageIndex < pdf.pages.length; pageIndex += 1) {
      const page = pdf.pages[pageIndex];
      if (!page) {
        result.error = `Failed to read PDF page ${pageIndex + 1}.`;
        return result;
      }

      let pageLineNumber = 0;
      let currentLineFragmentCount = 0;
      let currentLineCenter = 0;
      let currentLineHeight = 0;

      for (const textBox of page.text_boxes) {
        const fragment = textBox.text;
        if (fragment.length === 0) {
          continue;
        }

        const center = verticalCenter(textBox);
        const height = Math.max(1, textBox.height);
        const lastLine = lines[lines.length - 1];
        const startsNewLine =
          lastLine === undefined ||
          lastLine.page_number !== pageIndex + 1 ||
          !belongsToLine(textBox, currentLineCenter, currentLineHeight);

        if (startsNewLine) {
          pageLineNumber += 1;
          lines.push({
            page_number: pageIndex + 1,
            line_number: pageLineNumber,
            text: "",
            font_sizes: [],
            top: textBox.top,
            bottom: textBox.bottom,
            height,
          });
          currentLineCenter = center;
          currentLineHeight = height;
          currentLineFragmentCount = 1;
        } else {
          const weight = currentLineFragmentCount;
          currentLineCenter =
            (currentLineCenter * weight + center) / (weight + 1);
          currentLineFragmentCount += 1;
          currentLineHeight = Math.max(currentLineHeight, height);

          const currentLine = lines[lines.length - 1];
          currentLine.top = Math.min(currentLine.top, textBox.top);
          currentLine.bottom = Math.max(currentLine.bottom, textBox.bottom);
          currentLine.height = Math.max(
            1,
            currentLine.bottom - currentLine.top,
          );
        }

        const line = lines[lines.length - 1];
        if (
          line.text.length > 0 &&
          !line.text.endsWith(" ") &&
          !fragment.startsWith(" ")
        ) {
          line.text += " ";
        }
        line.text += fragment;

        const fontSize = textBox.font_size;
        if (fontSize !== undefined && Number.isFinite(fontSize) && fontSize > 0) {
          const normalized =
            Math.round(fontSize * precisionScale) / precisionScale;
          line.font_sizes.push(normalized);
          fontFrequency.set(
            normalized,
            (fontFrequency.get(normalized) ?? 0) + 1,
          );
        }
      }
    }

    if (fontFrequency.size === 0) {
      result.error =
        "No extractable text with font information was found. " +
        "The PDF may be scanned or contain outlined text.";
      return result;
    }

    let bodyFontSize = 0;
    let highestFrequency = 0;
    for (const [fontSize, frequency] of fontFrequency) {
      if (frequency > highestFrequency) {
        bodyFontSize = fontSize;
        highestFrequency = frequency;
      }
    }

    const headingStack: HeadingFrame[] = [];
    const paragraph: ParagraphFrame = {
      active: false,
      parent_path: [],
      child_index: 0,
      page_number: 0,
      previous_bottom: 0,
      previous_height: 1,
    };

    for (const line of lines) {
      if (line.text.length === 0) {
        continue;
      }

      const headingLevel = headingLevelForLine(
        line,
        bodyFontSize,
        this.config,
      );

      if (trim(line.text) === "End of topic.") {
        paragraph.active = false;

        if (headingLevel === 0) {
          result.error =
            `The 'End of topic.' marker on page ${line.page_number}, line ${line.line_number} does not use a configured heading font size.`;
          return result;
        }

        if (headingStack.length === 0) {
          result.error =
            `Unexpected 'End of topic.' marker at H${headingLevel} on page ${line.page_number}, line ${line.line_number}: there is no active heading to close.`;
          return result;
        }

        const activeHeading = headingStack[headingStack.length - 1];
        if (activeHeading.level !== headingLevel) {
          result.error =
            `Invalid 'End of topic.' marker at H${headingLevel} on page ${line.page_number}, line ${line.line_number}: the active heading is H${activeHeading.level}. Close nested headings in reverse order.`;
          return result;
        }

        const headingNode = nodeAtPath(result.document, activeHeading.path);
        if (!headingNode || headingNode.type !== DocumentNodeType.Heading) {
          result.error =
            "Internal hierarchy path became invalid while closing a heading.";
          return result;
        }

        headingNode.end_page_number = line.page_number;
        headingNode.end_line_number = line.line_number;
        headingStack.pop();
        continue;
      }

      if (headingLevel !== 0) {
        paragraph.active = false;

        while (
          headingStack.length > 0 &&
          headingStack[headingStack.length - 1].level >= headingLevel
        ) {
          headingStack.pop();
        }

        const parentPath =
          headingStack.length > 0
            ? [...headingStack[headingStack.length - 1].path]
            : [];
        const parent = nodeAtPath(result.document, parentPath);
        if (!parent) {
          result.error = "Internal hierarchy path became invalid.";
          return result;
        }

        const headingNode = createDocumentNode();
        headingNode.type = DocumentNodeType.Heading;
        headingNode.heading_level = headingLevel;
        headingNode.text = line.text;
        headingNode.page_number = line.page_number;
        headingNode.line_number = line.line_number;
        headingNode.end_page_number = line.page_number;
        headingNode.end_line_number = line.line_number;

        const childIndex = parent.children.length;
        parent.children.push(headingNode);
        headingStack.push({
          level: headingLevel,
          path: [...parentPath, childIndex],
        });
        continue;
      }

      const parentPath =
        headingStack.length > 0
          ? [...headingStack[headingStack.length - 1].path]
          : [];
      const parent = nodeAtPath(result.document, parentPath);
      if (!parent) {
        result.error = "Internal hierarchy path became invalid.";
        return result;
      }

      const gap =
        paragraph.active && paragraph.page_number === line.page_number
          ? Math.max(0, line.top - paragraph.previous_bottom)
          : Number.POSITIVE_INFINITY;
      const paragraphGapLimit = Math.max(4, line.height * 0.75);

      let existingParagraph: DocumentNode | undefined;
      if (
        paragraph.active &&
        paragraph.page_number === line.page_number &&
        paragraph.parent_path.length === parentPath.length &&
        paragraph.parent_path.every((value, index) => value === parentPath[index]) &&
        gap <= Math.max(paragraphGapLimit, paragraph.previous_height * 0.75)
      ) {
        const paragraphParent = nodeAtPath(result.document, paragraph.parent_path);
        if (
          paragraphParent &&
          paragraph.child_index < paragraphParent.children.length
        ) {
          existingParagraph = paragraphParent.children[paragraph.child_index];
        }
      }

      if (existingParagraph) {
        existingParagraph.text += " ";
        existingParagraph.text += line.text;
        existingParagraph.end_page_number = line.page_number;
        existingParagraph.end_line_number = line.line_number;
      } else {
        const paragraphNode = createDocumentNode();
        paragraphNode.type = DocumentNodeType.Paragraph;
        paragraphNode.text = line.text;
        paragraphNode.page_number = line.page_number;
        paragraphNode.line_number = line.line_number;
        paragraphNode.end_page_number = line.page_number;
        paragraphNode.end_line_number = line.line_number;

        paragraph.child_index = parent.children.length;
        parent.children.push(paragraphNode);
        paragraph.parent_path = parentPath;
        paragraph.page_number = line.page_number;
        paragraph.active = true;
      }

      paragraph.previous_bottom = line.bottom;
      paragraph.previous_height = line.height;
    }

    populatePageSpan(result.document);
    result.is_successful = true;
    return result;
  }
}
