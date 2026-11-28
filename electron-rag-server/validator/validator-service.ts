/**
 * TypeScript validation pipeline coordinator.
 *
 * Mirrors the validation-stage orchestration in
 * rag-server/validator/validator_service.cpp.
 *
 * PDF.js parsing is handled by PdfJsDocumentParser before this service is
 * called. This coordinator validates the parser's normalized PDF data.
 */

import { RagConfig } from "../config/config.js";
import {
  ExtractedPdfData,
  FontSizeValidator,
  ValidationReport,
} from "./font-size-validator.js";
import { HeadingLevelValidator } from "./heading-level-validator.js";
import { PageLimitValidator } from "./page-limit-validator.js";

export class ValidatorService {
  private readonly fontSizeValidator: FontSizeValidator;
  private readonly headingLevelValidator: HeadingLevelValidator;
  private readonly pageLimitValidator: PageLimitValidator;

  public constructor(config: Partial<RagConfig> = {}) {
    const sharedConfig = new RagConfig(config);

    this.fontSizeValidator = new FontSizeValidator(sharedConfig);
    this.headingLevelValidator = new HeadingLevelValidator(sharedConfig);
    this.pageLimitValidator = new PageLimitValidator(sharedConfig);
  }

  /**
   * Runs all applicable validation stages against extracted PDF data.
   *
   * Page-count validation runs independently. Heading traversal runs only
   * when the font-size validator reports valid configuration, matching the
   * C++ service behavior.
   */
  public validate(extractedData: ExtractedPdfData): ValidationReport {
    const report = new ValidationReport();

    report.append(
      this.pageLimitValidator.validate(extractedData.page_count),
    );

    const fontReport = this.fontSizeValidator.validate(extractedData);
    report.append(fontReport);

    if (fontReport.configuration_valid) {
      report.append(this.headingLevelValidator.validate(extractedData));
    }

    return report;
  }
}
