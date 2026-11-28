import { pipeline } from "@huggingface/transformers";
import { RagConfig } from "../config/config.js";

export interface EmbeddingResult {
  model_id: string;
  dimensions: number;
  embeddings: number[][];
}

interface FeatureExtractionOutput {
  tolist(): unknown;
}

type FeatureExtractionRunner = (
  texts: string[],
  options: { pooling: "cls"; normalize: true },
) => Promise<FeatureExtractionOutput>;

/**
 * Generates dense BGE-M3 vectors for embedding-ready text.
 *
 * The tokenizer and ONNX model are loaded from local directories configured
 * by RagConfig. This service never downloads model files during startup.
 */
export class EmbeddingService {
  public static readonly dimensions = 1024;
  public static readonly modelMaxSequenceLength = 8192;

  private constructor(
    private readonly featureExtractor: FeatureExtractionRunner,
    private readonly batchSize: number,
    private readonly modelId: string,
  ) {}

  /**
   * Loads the Transformers.js-compatible ONNX export from the configured
   * local model directory and keeps it in memory for subsequent calls.
   */
  public static async load(
    config: RagConfig = new RagConfig(),
    batchSize = 8,
  ): Promise<EmbeddingService> {
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
      throw new Error("Embedding batch size must be a positive integer.");
    }

    const modelPath = config.getEmbeddingModelPath();
    try {
      const featureExtractor = (await pipeline(
        "feature-extraction",
        modelPath,
        { revision: config.embedding_model_revision, local_files_only: true },
      )) as unknown as FeatureExtractionRunner;

      return new EmbeddingService(
        featureExtractor,
        batchSize,
        config.embedding_model_id,
      );
    } catch (error) {
      throw new Error(
        `Unable to load the local BGE-M3 ONNX model from "${modelPath}". Download the ONNX model files using the revision configured in config/config.ts. Remote model downloads are disabled.`,
        { cause: error },
      );
    }
  }

  /**
   * Generates one normalized 1024-dimensional dense vector per input.
   * Input order is preserved across batches.
   */
  public async embedTexts(texts: string[]): Promise<EmbeddingResult> {
    if (!Array.isArray(texts)) {
      throw new Error("Embedding input must be an array of strings.");
    }

    if (texts.some((text) => typeof text !== "string" || text.trim().length === 0)) {
      throw new Error("Embedding input cannot contain empty or non-string text.");
    }

    const embeddings: number[][] = [];

    for (let offset = 0; offset < texts.length; offset += this.batchSize) {
      const batch = texts.slice(offset, offset + this.batchSize);
      const output = await this.featureExtractor(batch, {
        pooling: "cls",
        normalize: true,
      });
      const values = output.tolist();

      if (!Array.isArray(values)) {
        throw new Error("The embedding model returned an invalid tensor.");
      }

      const batchVectors =
        batch.length === 1 && typeof values[0] === "number"
          ? [values as number[]]
          : (values as number[][]);

      if (batchVectors.length !== batch.length) {
        throw new Error(
          `Embedding model returned ${batchVectors.length} vectors for ${batch.length} inputs.`,
        );
      }

      for (const vector of batchVectors) {
        if (
          !Array.isArray(vector) ||
          vector.length !== EmbeddingService.dimensions ||
          vector.some((value) => !Number.isFinite(value))
        ) {
          throw new Error(
            `Embedding model must return finite ${EmbeddingService.dimensions}-dimensional vectors.`,
          );
        }
        embeddings.push(vector);
      }
    }

    return {
      model_id: this.modelId,
      dimensions: EmbeddingService.dimensions,
      embeddings,
    };
  }
}
