/**
 * TypeScript translation of rag-server/validator/heading_level_validator.cpp.
 *
 * Heading detection, hierarchy transitions, explicit closure rules, and
 * validation messages mirror the C++ implementation.
 */

import { RagConfig } from "../config/config.js";
import {
  ExtractedPdfData,
  ExtractedPdfLine,
  ValidationReport,
} from "./font-size-validator.js";

interface ActiveHeading {
  level: number;
  line: ExtractedPdfLine;
}

function issueAtLine(reason: string, line: ExtractedPdfLine) {
  reason +=
    " Page " +
    line.page_number.toString() +
    ", line " +
    line.line_number.toString() +
    " (" +
    line.word_count.toString() +
    " words).";

  return {
    reason,
    page_number: line.page_number,
    line_number: line.line_number,
    word_count: line.word_count,
    line_text: line.text,
  };
}

function trim(value: string): string {
  return value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
}

function detectHeadingLevel(
  line: ExtractedPdfLine,
  extractedData: ExtractedPdfData,
  config: RagConfig,
): number {
  let lineLevel = 0;
  let largestHeadingSize = 0.0;

  for (const fontSize of line.font_sizes) {
    if (
      fontSize <=
      extractedData.body_font_size +
        config.body_font_size_tolerance_points
    ) {
      continue;
    }

    let matchedLevel = 0;
    let smallestDifference = Number.POSITIVE_INFINITY;

    // Map iteration follows the configured heading-level order.
    for (const [level, expectedSize] of config.heading_font_sizes) {
      const difference = Math.abs(fontSize - expectedSize);
      if (difference < smallestDifference) {
        smallestDifference = difference;
        matchedLevel = level;
      }
    }

    if (
      smallestDifference <= config.heading_font_size_tolerance_points &&
      fontSize > largestHeadingSize
    ) {
      largestHeadingSize = fontSize;
      lineLevel = matchedLevel;
    }
  }

  return lineLevel;
}

export class HeadingLevelValidator {
  private readonly config: RagConfig;

  public constructor(config: Partial<RagConfig> = {}) {
    this.config = new RagConfig(config);
  }

  public validate(extractedData: ExtractedPdfData): ValidationReport {
    const report = new ValidationReport();

    if (extractedData.lines.length === 0) {
      report.addIssue({
        reason:
          "No extracted PDF lines were provided for heading hierarchy validation.",
      });
      return report;
    }

    const endMarker = "End of topic.";
    const activeHeadings: ActiveHeading[] = [];
    let detectedAnyHeading = false;

    for (const line of extractedData.lines) {
      const lineLevel = detectHeadingLevel(
        line,
        extractedData,
        this.config,
      );

      if (lineLevel === 0) {
        continue;
      }

      detectedAnyHeading = true;
      const isEndMarker = trim(line.text) === endMarker;

      if (isEndMarker) {
        if (activeHeadings.length === 0) {
          report.addIssue(
            issueAtLine(
              "Unexpected heading closure at H" +
                lineLevel.toString() +
                ": there is no active heading to close.",
              line,
            ),
          );
          continue;
        }

        const activeLevel =
          activeHeadings[activeHeadings.length - 1].level;

        if (activeLevel !== lineLevel) {
          report.addIssue(
            issueAtLine(
              "Invalid heading closure at H" +
                lineLevel.toString() +
                ": the currently active heading is H" +
                activeLevel.toString() +
                ". Close nested headings in reverse order before closing their parent.",
              line,
            ),
          );
          continue;
        }

        activeHeadings.pop();
        continue;
      }

      if (activeHeadings.length === 0) {
        activeHeadings.push({ level: lineLevel, line });
        continue;
      }

      const activeLevel =
        activeHeadings[activeHeadings.length - 1].level;

      if (lineLevel <= activeLevel) {
        report.addIssue(
          issueAtLine(
            "Heading H" +
              lineLevel.toString() +
              " starts while H" +
              activeLevel.toString() +
              " is still open. Add an H" +
              activeLevel.toString() +
              " 'End of topic.' line before opening this heading.",
            line,
          ),
        );
        continue;
      }

      if (lineLevel !== activeLevel + 1) {
        report.addIssue(
          issueAtLine(
            "Invalid heading level transition from H" +
              activeLevel.toString() +
              " to H" +
              lineLevel.toString() +
              ". Heading levels may descend by only one level at a time.",
            line,
          ),
        );
        continue;
      }

      activeHeadings.push({ level: lineLevel, line });
    }

    if (!detectedAnyHeading) {
      report.addIssue({
        reason:
          "No heading levels could be derived from the extracted PDF lines.",
      });
      return report;
    }

    // Match C++ reverse-iterator order: report the deepest/latest open
    // heading first, then its parent headings.
    for (let index = activeHeadings.length - 1; index >= 0; index -= 1) {
      const activeHeading = activeHeadings[index];
      report.addIssue(
        issueAtLine(
          "Heading H" +
            activeHeading.level.toString() +
            " was not explicitly closed. Add an H" +
            activeHeading.level.toString() +
            " 'End of topic.' line before the document ends.",
          activeHeading.line,
        ),
      );
    }

    return report;
  }
}
