/**
 * Shared configuration for the Electron RAG server.
 *
 * Combines chunking limits, PDF validation limits, and document typography
 * settings previously maintained in separate component-specific config types.
 */
export class RagConfig {
  /** Maximum tokens in the complete embedding input, including heading context. */
  public max_chunk_tokens = 512;

  /** Minimum number of pages required in an input PDF. */
  public minimum_pages = 1;

  /** Maximum number of pages allowed. Zero disables the upper limit. */
  public maximum_pages = 0;

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

  /** Minimum difference above the detected body size for a line to be considered a heading candidate. */
  public body_font_size_tolerance_points = 0.5;

  /** Maximum difference allowed from the detected body-font baseline for paragraph/body text. */
  public paragraph_font_size_tolerance_points = 0.5;

  /** Decimal places retained when normalizing extracted font sizes. */
  public font_size_precision_decimal_places = 2;

  public constructor(config: Partial<RagConfig> = {}) {
    Object.assign(this, config);
    this.heading_font_sizes = new Map(
      config.heading_font_sizes ?? this.heading_font_sizes,
    );
  }
}
