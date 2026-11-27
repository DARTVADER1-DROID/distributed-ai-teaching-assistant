/** Token limits for structure-aware document chunking. */
export class ChunkerConfig {
  /** Maximum tokens in the complete embedding input, including heading context. */
  public max_chunk_tokens = 512;

  public constructor(config: Partial<ChunkerConfig> = {}) {
    Object.assign(this, config);
  }
}
