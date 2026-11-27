import { AutoTokenizer } from "@huggingface/transformers";

/**
 * BGE-M3 uses the XLM-RoBERTa tokenizer published with the model.
 * Keep the tokenizer revision pinned so chunk boundaries are reproducible.
 */
export class BgeM3Tokenizer {
  public static readonly modelId = "BAAI/bge-m3";
  public static readonly revision =
    "b28ce2a6fcc9c75ef1c0619575d0ec19af760082";
  public static readonly modelMaxSequenceLength = 8192;

  private constructor(
    private readonly tokenizer: Awaited<
      ReturnType<typeof AutoTokenizer.from_pretrained>
    >,
  ) {}

  public static async load(): Promise<BgeM3Tokenizer> {
    const tokenizer = await AutoTokenizer.from_pretrained(
      BgeM3Tokenizer.modelId,
      { revision: BgeM3Tokenizer.revision },
    );
    return new BgeM3Tokenizer(tokenizer);
  }

  /**
   * Counts the complete model input, including XLM-RoBERTa special tokens.
   * This is synchronous after the tokenizer has been loaded.
   */
  public countTokens(text: string): number {
    return this.tokenizer.tokenize(text, { add_special_tokens: true }).length;
  }
}
