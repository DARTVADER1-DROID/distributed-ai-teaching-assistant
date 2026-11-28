import { resolve } from "node:path";

/**
 * Shared configuration for the Electron RAG server.
 *
 * All model paths are local directories. The application never downloads
 * model weights implicitly; users prepare the directories before ingestion
 * or semantic retrieval.
 */
export class RagConfig {
  /** Maximum tokens in the complete embedding input, including heading context. */
  public max_chunk_tokens = 512;

  /** Minimum number of pages required in an input PDF. */
  public minimum_pages = 1;

  /** Maximum number of pages allowed. Zero disables the upper limit. */
  public maximum_pages = 0;

  /** Root directory containing the locally downloaded model folders. */
  public model_directory = "./models";

  /** Relative (or absolute) path to the BGE-M3 tokenizer directory. */
  public tokenizer_model_directory = "bge-m3-onnx";

  /** Relative (or absolute) path to the Transformers.js ONNX model directory. */
  public embedding_model_directory = "bge-m3-onnx";

  /** Hugging Face repository and immutable revision used to prepare the tokenizer files. */
  public tokenizer_model_id = "onnx-community/bge-m3-ONNX";
  public tokenizer_model_revision = "25b9af8e87a38eb120cfe87125383677b9cd309e";

  /** Hugging Face repository and immutable revision used to prepare the ONNX model files. */
  public embedding_model_id = "onnx-community/bge-m3-ONNX";
  public embedding_model_revision = "25b9af8e87a38eb120cfe87125383677b9cd309e";

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

  /** Builds configuration from supported environment overrides. */
  public static fromEnvironment(): RagConfig {
    return new RagConfig({
      model_directory: process.env.MODEL_DIRECTORY ?? "./models",
      tokenizer_model_directory:
        process.env.TOKENIZER_MODEL_DIRECTORY ?? "bge-m3-onnx",
      embedding_model_directory:
        process.env.EMBEDDING_MODEL_DIRECTORY ?? "bge-m3-onnx",
    });
  }

  /** Absolute path passed to Transformers.js for tokenizer loading. */
  public getTokenizerModelPath(): string {
    return resolve(this.model_directory, this.tokenizer_model_directory);
  }

  /** Absolute path passed to Transformers.js for ONNX model loading. */
  public getEmbeddingModelPath(): string {
    return resolve(this.model_directory, this.embedding_model_directory);
  }
}
