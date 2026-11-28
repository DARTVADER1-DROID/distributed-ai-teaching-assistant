import { AutoTokenizer } from "@huggingface/transformers";
import { RagConfig } from "../config/config.js";

/**
 * BGE-M3 uses the XLM-RoBERTa tokenizer published with the model.
 * Its source repository and immutable revision are recorded in RagConfig.
 */
export class BgeM3Tokenizer {
  public static readonly modelMaxSequenceLength = 8192;

  private constructor(
    private readonly tokenizer: Awaited<
      ReturnType<typeof AutoTokenizer.from_pretrained>
    >,
  ) {}

  public static async load(
    config: RagConfig = new RagConfig(),
  ): Promise<BgeM3Tokenizer> {
    const modelPath = config.getTokenizerModelPath();
    try {
      const tokenizer = await AutoTokenizer.from_pretrained(modelPath, {
        local_files_only: true,
      });
      return new BgeM3Tokenizer(tokenizer);
    } catch (error) {
      throw new Error(
        `Unable to load the local BGE-M3 tokenizer from "${modelPath}". Download the tokenizer files using the revision configured in config/config.ts. Remote model downloads are disabled.`,
        { cause: error },
      );
    }
  }

  /**
   * Counts the complete model input, including XLM-RoBERTa special tokens.
   * This is synchronous after the tokenizer has been loaded.
   */
  public countTokens(text: string): number {
    return this.tokenizer.tokenize(text, { add_special_tokens: true }).length;
  }
}
