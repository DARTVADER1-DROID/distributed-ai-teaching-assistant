#pragma once

#include <cstddef>

namespace rag {

// Token limits used by the structure-aware chunker.
// The default is an initial retrieval baseline and should be benchmarked
// against representative documents and retrieval questions.
struct ChunkerConfig {
    std::size_t max_chunk_tokens = 512;
};

} // namespace rag
