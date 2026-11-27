/**
 * Shared document typography rules used by validation and extraction.
 * Font sizes are expressed in PDF points.
 */
export class DocumentFormatConfig {
  /** Expected heading sizes. Keys are heading levels 1 (H1) through 6 (H6). */
  public heading_font_sizes: Map<number, number> = new Map([
    [1, 24.0],
    [2, 20.0],
    [3, 18.0],
    [4, 16.0],
    [5, 14.0],
    [6, 12.0],
  ]);

  /** Maximum difference from a configured heading size. */
  public heading_font_size_tolerance_points = 0.5;

  /**
   * Minimum difference above the detected body size for a line to be
   * considered a heading candidate.
   */
  public body_font_size_tolerance_points = 0.5;

  /** Maximum difference allowed from the detected body-font baseline for paragraph/body text. */
  public paragraph_font_size_tolerance_points = 0.5;

  /** Decimal places retained when normalizing extracted font sizes. */
  public font_size_precision_decimal_places = 2;

  public constructor(config: Partial<DocumentFormatConfig> = {}) {
    Object.assign(this, config);
    this.heading_font_sizes = new Map(
      config.heading_font_sizes ?? this.heading_font_sizes,
    );
  }
}
