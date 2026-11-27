/**
 * TypeScript translation of rag-server/validator/page_limit_validator.cpp.
 */

import { RagConfig } from "../config/config.js";
import { ValidationReport } from "./font-size-validator.js";

export class PageLimitValidator {
  private readonly config: RagConfig;

  public constructor(config: Partial<RagConfig> = {}) {
    this.config = new RagConfig(config);
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
