/**
 * TypeScript validation pipeline coordinator.
 *
 * Mirrors the validation-stage orchestration in
 * rag-server/validator/validator_service.cpp.
 *
 * PDF parsing/extraction is deliberately not implemented here yet. This
 * service receives ExtractedPdfData from the future TypeScript PDF extractor.
 */

import { ValidatorConfig } from "./config/validator-config";
import {
  ExtractedPdfData,
  FontSizeValidator,
  ValidationReport,
} from "./font-size-validator";
import { HeadingLevelValidator } from "./heading-level-validator";
import { PageLimitValidator } from "./page-limit-validator";

export class ValidatorService {
  private readonly fontSizeValidator: FontSizeValidator;
  private readonly headingLevelValidator: HeadingLevelValidator;
  private readonly pageLimitValidator: PageLimitValidator;

  public constructor(config: Partial<ValidatorConfig> = {}) {
    const sharedConfig = new ValidatorConfig(config);

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
