import { pipeline } from "@huggingface/transformers";

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
 * This service is deliberately independent from BgeM3Tokenizer:
 * - BgeM3Tokenizer counts tokens for chunk-size enforcement.
 * - EmbeddingService runs the ONNX model and returns dense vectors.
 *
 * It does not persist vectors or modify chunks. Those responsibilities
 * belong to later pipeline stages.
 */
export class EmbeddingService {
  public static readonly modelId = "onnx-community/bge-m3-ONNX";
  public static readonly dimensions = 1024;
  public static readonly modelMaxSequenceLength = 8192;

  private constructor(
    private readonly featureExtractor: FeatureExtractionRunner,
    private readonly batchSize: number,
  ) {}

  /**
   * Loads the Transformers.js-compatible ONNX export of BGE-M3.
   * The returned instance keeps the model in memory for subsequent calls.
   */
  public static async load(batchSize = 8): Promise<EmbeddingService> {
    if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
      throw new Error("Embedding batch size must be a positive integer.");
    }

    const featureExtractor = (await pipeline(
      "feature-extraction",
      EmbeddingService.modelId,
    )) as unknown as FeatureExtractionRunner;

    return new EmbeddingService(featureExtractor, batchSize);
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
      model_id: EmbeddingService.modelId,
      dimensions: EmbeddingService.dimensions,
      embeddings,
    };
  }
}
