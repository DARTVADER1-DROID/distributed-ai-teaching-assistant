import { DocumentFormatConfig } from "./document-format-config";

/**
 * Validator-specific settings combined with the shared document typography
 * rules used by both validation and extraction.
 */
export class ValidatorConfig extends DocumentFormatConfig {
  /** Minimum number of pages required in an input PDF. */
  public minimum_pages = 1;

  /** Maximum number of pages allowed. Zero disables the upper limit. */
  public maximum_pages = 0;

  public constructor(config: Partial<ValidatorConfig> = {}) {
    super(config);
    this.minimum_pages = config.minimum_pages ?? this.minimum_pages;
    this.maximum_pages = config.maximum_pages ?? this.maximum_pages;
  }
}
