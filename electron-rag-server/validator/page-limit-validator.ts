/**
 * TypeScript translation of rag-server/validator/page_limit_validator.cpp.
 */

import { ValidatorConfig } from "./config/validator-config";
import { ValidationReport } from "./font-size-validator";

export class PageLimitValidator {
  private readonly config: ValidatorConfig;

  public constructor(config: Partial<ValidatorConfig> = {}) {
    this.config = new ValidatorConfig(config);
  }

  public validate(pageCount: number): ValidationReport {
    const report = new ValidationReport();

    if (
      this.config.maximum_pages !== 0 &&
      this.config.maximum_pages < this.config.minimum_pages
    ) {
      report.configuration_valid = false;
      report.addIssue({
        reason:
          "Invalid page-limit configuration: maximum_pages must be zero " +
          "or greater than or equal to minimum_pages.",
      });
      return report;
    }

    if (pageCount < this.config.minimum_pages) {
      report.addIssue({
        reason:
          "PDF contains " +
          pageCount.toString() +
          " pages; the minimum required is " +
          this.config.minimum_pages.toString() +
          ".",
      });
    }

    if (
      this.config.maximum_pages !== 0 &&
      pageCount > this.config.maximum_pages
    ) {
      report.addIssue({
        reason:
          "PDF contains " +
          pageCount.toString() +
          " pages; the maximum allowed is " +
          this.config.maximum_pages.toString() +
          ".",
      });
    }

    return report;
  }
}
