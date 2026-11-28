import assert from "node:assert/strict";
import { resolve } from "node:path";
import { RagConfig } from "./config.js";

async function main(): Promise<void> {
  const defaults = new RagConfig();
  assert.equal(
    defaults.getTokenizerModelPath(),
    resolve(process.cwd(), "models", "bge-m3-onnx"),
  );
  assert.equal(
    defaults.getEmbeddingModelPath(),
    resolve(process.cwd(), "models", "bge-m3-onnx"),
  );

  const previous = {
    model: process.env.MODEL_DIRECTORY,
    tokenizer: process.env.TOKENIZER_MODEL_DIRECTORY,
    embedding: process.env.EMBEDDING_MODEL_DIRECTORY,
  };

  try {
    process.env.MODEL_DIRECTORY = "./local-assets";
    process.env.TOKENIZER_MODEL_DIRECTORY = "tokenizer";
    process.env.EMBEDDING_MODEL_DIRECTORY = "onnx";
    const configured = RagConfig.fromEnvironment();

    assert.equal(
      configured.getTokenizerModelPath(),
      resolve(process.cwd(), "local-assets", "tokenizer"),
    );
    assert.equal(
      configured.getEmbeddingModelPath(),
      resolve(process.cwd(), "local-assets", "onnx"),
    );
  } finally {
    if (previous.model === undefined) delete process.env.MODEL_DIRECTORY;
    else process.env.MODEL_DIRECTORY = previous.model;
    if (previous.tokenizer === undefined) delete process.env.TOKENIZER_MODEL_DIRECTORY;
    else process.env.TOKENIZER_MODEL_DIRECTORY = previous.tokenizer;
    if (previous.embedding === undefined) delete process.env.EMBEDDING_MODEL_DIRECTORY;
    else process.env.EMBEDDING_MODEL_DIRECTORY = previous.embedding;
  }

  console.log("RAG configuration test passed.");
}

void main().catch((error: unknown) => {
  console.error("RAG configuration test failed:", error);
  process.exitCode = 1;
});
