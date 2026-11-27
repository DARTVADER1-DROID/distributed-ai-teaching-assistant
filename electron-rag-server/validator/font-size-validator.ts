/**
 * TypeScript translation of rag-server/validator/font_size_validator.cpp.
 *
 * The validation rules, thresholds, issue messages, and evaluation order are
 * intentionally kept aligned with the C++ implementation.
 */

import { ValidatorConfig } from "./config/validator-config";

export interface ExtractedPdfLine {
  page_number: number;
  line_number: number;
  text: string;
  word_count: number;
  font_sizes: number[];
}

export interface ExtractedPdfData {
  page_count: number;
  lines: ExtractedPdfLine[];
  ordered_font_sizes: number[];
  font_size_frequency: Map<number, number> | Record<number, number>;
  body_font_size: number;
}

export interface ValidationIssue {
  reason: string;
  page_number: number;
  line_number: number;
  word_count: number;
  line_text: string;
}

export class ValidationReport {
  public readonly issues: ValidationIssue[] = [];
  public configuration_valid = true;

  public isValid(): boolean {
    return this.issues.length === 0;
  }

  public addIssue(issue: Partial<ValidationIssue> & Pick<ValidationIssue, "reason">): void {
    this.issues.push({
      reason: issue.reason,
      page_number: issue.page_number ?? 0,
      line_number: issue.line_number ?? 0,
      word_count: issue.word_count ?? 0,
      line_text: issue.line_text ?? "",
    });
  }

  public append(other: ValidationReport): void {
    this.issues.push(...other.issues);
    this.configuration_valid = this.configuration_valid && other.configuration_valid;
  }
}

// C++ ostream's default floating-point precision is six significant digits.
function formatFontSize(fontSize: number): string {
  if (!Number.isFinite(fontSize)) {
    return String(fontSize);
  }

  return Number(fontSize.toPrecision(6)).toString();
}

function issueAtLine(reason: string, line: ExtractedPdfLine): ValidationIssue {
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

function isHeadingCandidateLine(
  line: ExtractedPdfLine,
  bodyFontSize: number,
  bodyTolerance: number,
): boolean {
  for (const size of line.font_sizes) {
    if (size > bodyFontSize + bodyTolerance) {
      return true;
    }
  }
  return false;
}

function headingEntries(
  headingFontSizes: ValidatorConfig["heading_font_sizes"],
): Array<[number, number]> {
  return Array.from(headingFontSizes.entries()).sort(
    (left, right) => left[0] - right[0],
  );
}

export class FontSizeValidator {
  private readonly config: ValidatorConfig;

  public constructor(config: Partial<ValidatorConfig> = {}) {
    this.config = new ValidatorConfig(config);
  }

  private validateConfiguration(): ValidationReport {
    const report = new ValidationReport();
    const configuredHeadingSizes = headingEntries(this.config.heading_font_sizes);

    if (configuredHeadingSizes.length === 0) {
      report.addIssue({ reason: "Configuration has no heading font sizes." });
    }

    for (const [level, size] of configuredHeadingSizes) {
      if (level < 1 || level > 6) {
        report.addIssue({
          reason:
            "Configuration contains an invalid heading level; expected H1-H6.",
        });
      }
      if (!Number.isFinite(size) || size <= 0.0) {
        report.addIssue({
          reason:
            "Configured heading font sizes must be finite and greater than zero.",
        });
      }
    }

    if (
      !Number.isFinite(this.config.heading_font_size_tolerance_points) ||
      this.config.heading_font_size_tolerance_points < 0.0
    ) {
      report.addIssue({
        reason:
          "Heading font-size tolerance must be finite and non-negative.",
      });
    }
    if (
      !Number.isFinite(this.config.body_font_size_tolerance_points) ||
      this.config.body_font_size_tolerance_points < 0.0
    ) {
      report.addIssue({
        reason: "Body font-size tolerance must be finite and non-negative.",
      });
    }
    if (
      !Number.isFinite(this.config.paragraph_font_size_tolerance_points) ||
      this.config.paragraph_font_size_tolerance_points < 0.0
    ) {
      report.addIssue({
        reason:
          "Paragraph font-size tolerance must be finite and non-negative.",
      });
    }
    if (
      this.config.font_size_precision_decimal_places < 0 ||
      this.config.font_size_precision_decimal_places > 6
    ) {
      report.addIssue({
        reason: "Font-size precision must be between 0 and 6 decimal places.",
      });
    }

    report.configuration_valid = report.isValid();
    return report;
  }

  public validate(extractedData: ExtractedPdfData): ValidationReport {
    const report = this.validateConfiguration();
    if (!report.isValid()) {
      return report;
    }

    const frequencyIsEmpty =
      extractedData.font_size_frequency instanceof Map
        ? extractedData.font_size_frequency.size === 0
        : Object.keys(extractedData.font_size_frequency).length === 0;

    if (frequencyIsEmpty) {
      report.addIssue({ reason: "No extracted font sizes were provided." });
      return report;
    }

    const detectedHeadingSizes = new Map<number, number>();
    const configuredHeadingSizes = headingEntries(this.config.heading_font_sizes);

    for (const line of extractedData.lines) {
      if (line.font_sizes.length === 0 || line.text.length === 0) {
        continue;
      }

      // A visual line may contain one text box per word. Deduplicate sizes
      // so a repeated word-level font size creates only one issue per line.
      const lineFontSizes = new Set<number>(line.font_sizes);

      const headingCandidate = isHeadingCandidateLine(
        line,
        extractedData.body_font_size,
        this.config.body_font_size_tolerance_points,
      );

      if (headingCandidate) {
        // Validate heading candidates against the configured H1-H6 scale.
        for (const fontSize of lineFontSizes) {
          if (
            fontSize <=
            extractedData.body_font_size +
              this.config.body_font_size_tolerance_points
          ) {
            continue;
          }

          let matchedLevel = 0;
          let smallestDifference = Number.POSITIVE_INFINITY;

          for (const [level, expectedSize] of configuredHeadingSizes) {
            const difference = Math.abs(fontSize - expectedSize);
            if (difference < smallestDifference) {
              smallestDifference = difference;
              matchedLevel = level;
            }
          }

          if (
            smallestDifference >
            this.config.heading_font_size_tolerance_points
          ) {
            report.addIssue(
              issueAtLine(
                "Detected non-body text at " +
                  formatFontSize(fontSize) +
                  " pt, but it does not match any configured heading " +
                  "size (H1-H6, tolerance +/- " +
                  formatFontSize(
                    this.config.heading_font_size_tolerance_points,
                  ) +
                  " pt).",
                line,
              ),
            );
            continue;
          }

          const existing = detectedHeadingSizes.get(matchedLevel);
          if (
            existing !== undefined &&
            Math.abs(existing - fontSize) >
              this.config.heading_font_size_tolerance_points
          ) {
            report.addIssue(
              issueAtLine(
                "H" +
                  matchedLevel.toString() +
                  " uses inconsistent font sizes: " +
                  formatFontSize(existing) +
                  " pt and " +
                  formatFontSize(fontSize) +
                  " pt.",
                line,
              ),
            );
            continue;
          }

          if (existing === undefined) {
            detectedHeadingSizes.set(matchedLevel, fontSize);
          }
        }

        // Do not treat a heading line as a paragraph, even if it contains
        // additional text boxes using the body font size.
        continue;
      }

      // Non-heading lines are treated as paragraph/body-text candidates.
      // Compare each distinct size with the document's detected body baseline.
      for (const fontSize of lineFontSizes) {
        const difference = Math.abs(
          fontSize - extractedData.body_font_size,
        );

        if (
          difference <=
          this.config.paragraph_font_size_tolerance_points
        ) {
          continue;
        }

        report.addIssue(
          issueAtLine(
            "Paragraph text uses " +
              formatFontSize(fontSize) +
              " pt, but the detected body-font size is " +
              formatFontSize(extractedData.body_font_size) +
              " pt (allowed deviation +/- " +
              formatFontSize(
                this.config.paragraph_font_size_tolerance_points,
              ) +
              " pt).",
            line,
          ),
        );
      }
    }

    if (detectedHeadingSizes.size === 0 && report.isValid()) {
      report.addIssue({
        reason:
          "No heading font sizes could be identified. The PDF may contain " +
          "only body text, or its headings may use the same size as body text.",
      });
    }

    return report;
  }
}
