#include "chunker_service.hpp"

#include <algorithm>
#include <exception>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace rag {
namespace {

struct SourceRange {
    std::size_t start_page = 0;
    std::size_t end_page = 0;
    std::size_t start_line = 0;
    std::size_t end_line = 0;
};

bool isUtf8Continuation(unsigned char value) {
    return (value & 0xC0) == 0x80;
}

std::vector<std::size_t> utf8Boundaries(const std::string& text) {
    std::vector<std::size_t> boundaries{0};
    for (std::size_t i = 1; i < text.size(); ++i) {
        if (!isUtf8Continuation(static_cast<unsigned char>(text[i]))) {
            boundaries.push_back(i);
        }
    }
    if (boundaries.back() != text.size()) {
        boundaries.push_back(text.size());
    }
    return boundaries;
}

std::string makeEmbeddingText(
    const std::vector<std::string>& heading_path,
    const std::string& content
) {
    if (heading_path.empty()) {
        return content;
    }

    std::string result;
    for (const auto& heading : heading_path) {
        if (!result.empty()) {
            result += " > ";
        }
        result += heading;
    }
    result += '\n';
    result += content;
    return result;
}

std::size_t countTokens(
    const TokenCounter& counter,
    const std::vector<std::string>& heading_path,
    const std::string& content
) {
    return counter(makeEmbeddingText(heading_path, content));
}

bool isSentenceBoundary(char previous, char current) {
    return (previous == '.' || previous == '?' || previous == '!') &&
           (current == ' ' || current == '\t' ||
            current == '\r' || current == '\n');
}

bool isClauseBoundary(char previous, char current) {
    return (previous == ',' || previous == ';' || previous == ':') &&
           (current == ' ' || current == '\t' ||
            current == '\r' || current == '\n');
}

// Select the largest UTF-8-safe prefix that fits. Prefer a sentence boundary,
// then clause punctuation, then whitespace; otherwise use a character boundary.
std::size_t findSplitPosition(
    const std::string& text,
    const std::vector<std::size_t>& boundaries,
    std::size_t start,
    std::size_t max_tokens,
    const std::vector<std::string>& heading_path,
    const TokenCounter& counter
) {
    const auto start_it =
        std::lower_bound(boundaries.begin(), boundaries.end(), start);
    std::size_t low =
        static_cast<std::size_t>(start_it - boundaries.begin()) + 1;
    std::size_t high = boundaries.size() - 1;
    std::size_t best = start;

    while (low <= high) {
        const std::size_t middle = low + (high - low) / 2;
        const std::size_t end = boundaries[middle];
        const std::string candidate = text.substr(start, end - start);

        if (countTokens(counter, heading_path, candidate) <= max_tokens) {
            best = end;
            low = middle + 1;
        } else {
            if (middle == 0) {
                break;
            }
            high = middle - 1;
        }
    }

    if (best == start) {
        return start;
    }

    std::size_t sentence = 0;
    std::size_t clause = 0;
    std::size_t whitespace = 0;

    for (const std::size_t boundary : boundaries) {
        if (boundary <= start || boundary > best) {
            continue;
        }

        const char previous = text[boundary - 1];
        const char current = boundary < text.size() ? text[boundary] : '\0';

        if (boundary == text.size() ||
            current == ' ' || current == '\t' ||
            current == '\r' || current == '\n') {
            whitespace = boundary;
        }
        if (boundary < text.size() &&
            isClauseBoundary(previous, current)) {
            clause = boundary;
        }
        if (boundary < text.size() &&
            isSentenceBoundary(previous, current)) {
            sentence = boundary;
        }
    }

    if (sentence != 0) {
        return sentence;
    }
    if (clause != 0) {
        return clause;
    }
    if (whitespace != 0) {
        return whitespace;
    }
    return best;
}

std::vector<std::string> splitOversizedParagraph(
    const std::string& paragraph,
    const std::vector<std::string>& heading_path,
    std::size_t max_tokens,
    const TokenCounter& counter
) {
    std::vector<std::string> pieces;
    const auto boundaries = utf8Boundaries(paragraph);
    std::size_t start = 0;

    while (start < paragraph.size()) {
        const std::string remaining = paragraph.substr(start);
        if (countTokens(counter, heading_path, remaining) <= max_tokens) {
            pieces.push_back(remaining);
            break;
        }

        const std::size_t split = findSplitPosition(
            paragraph, boundaries, start, max_tokens, heading_path, counter
        );
        if (split <= start) {
            throw std::runtime_error(
                "A single UTF-8 character or tokenizer unit exceeds the "
                "configured chunk token limit."
            );
        }

        pieces.push_back(paragraph.substr(start, split - start));
        start = split;
    }

    return pieces;
}

void updateRange(
    DocumentChunk& chunk,
    const SourceRange& source,
    bool first_content
) {
    if (first_content) {
        chunk.start_page_number = source.start_page;
        chunk.start_line_number = source.start_line;
    }
    if (source.end_page != 0) {
        chunk.end_page_number = source.end_page;
    }
    if (source.end_line != 0) {
        chunk.end_line_number = source.end_line;
    }
}

class ChunkBuilder {
public:
    ChunkBuilder(
        std::size_t max_tokens,
        const TokenCounter& counter,
        std::vector<DocumentChunk>& output
    )
        : max_tokens_(max_tokens), counter_(counter), output_(output) {}

    void processParagraphGroup(
        const std::vector<const DocumentNode*>& paragraphs,
        const std::vector<std::string>& heading_path
    ) {
        DocumentChunk current;
        bool has_content = false;

        auto flush = [&]() {
            if (!has_content) {
                return;
            }
            current.index = output_.size();
            current.heading_path = heading_path;
            current.embedding_text =
                makeEmbeddingText(heading_path, current.text);
            output_.push_back(std::move(current));
            current = DocumentChunk{};
            has_content = false;
        };

        for (const DocumentNode* paragraph_node : paragraphs) {
            if (!paragraph_node || paragraph_node->text.empty()) {
                continue;
            }

            const SourceRange source{
                paragraph_node->page_number,
                paragraph_node->end_page_number != 0
                    ? paragraph_node->end_page_number
                    : paragraph_node->page_number,
                paragraph_node->line_number,
                paragraph_node->end_line_number != 0
                    ? paragraph_node->end_line_number
                    : paragraph_node->line_number
            };

            std::vector<std::string> pieces;
            if (countTokens(counter_, heading_path, paragraph_node->text)
                    <= max_tokens_) {
                pieces.push_back(paragraph_node->text);
            } else {
                pieces = splitOversizedParagraph(
                    paragraph_node->text, heading_path, max_tokens_, counter_
                );
            }

            bool first_piece = true;
            for (const auto& piece : pieces) {
                const std::string separator =
                    has_content && first_piece ? "\n\n" : "";
                const std::string candidate = current.text + separator + piece;

                if (has_content &&
                    countTokens(counter_, heading_path, candidate) > max_tokens_) {
                    flush();
                }

                const std::string actual_separator =
                    has_content && first_piece ? "\n\n" : "";
                const std::string updated =
                    current.text + actual_separator + piece;

                if (countTokens(counter_, heading_path, updated) > max_tokens_) {
                    flush();
                    if (countTokens(counter_, heading_path, piece) > max_tokens_) {
                        throw std::runtime_error(
                            "A paragraph fragment exceeds the configured "
                            "chunk token limit."
                        );
                    }
                }

                const bool starts_chunk = !has_content;
                if (has_content) {
                    if (first_piece) {
                        current.text += "\n\n";
                    }
                    current.text += piece;
                } else {
                    current.text = piece;
                    has_content = true;
                }

                updateRange(current, source, starts_chunk);
                first_piece = false;
            }
        }

        flush();
    }

private:
    std::size_t max_tokens_;
    const TokenCounter& counter_;
    std::vector<DocumentChunk>& output_;
};

void traverse(
    const DocumentNode& node,
    std::vector<std::string>& heading_path,
    ChunkBuilder& builder
) {
    std::vector<const DocumentNode*> paragraph_group;

    auto flush_group = [&]() {
        if (!paragraph_group.empty()) {
            builder.processParagraphGroup(paragraph_group, heading_path);
            paragraph_group.clear();
        }
    };

    for (const auto& child : node.children) {
        if (child.type == DocumentNodeType::Paragraph) {
            paragraph_group.push_back(&child);
            continue;
        }

        flush_group();

        if (child.type == DocumentNodeType::Heading) {
            heading_path.push_back(child.text);
            traverse(child, heading_path, builder);
            heading_path.pop_back();
        } else if (child.type == DocumentNodeType::Document) {
            traverse(child, heading_path, builder);
        }
    }

    flush_group();
}

} // namespace

ChunkerService::ChunkerService(
    ChunkerConfig config,
    TokenCounter token_counter
)
    : config_(std::move(config)),
      token_counter_(std::move(token_counter)) {}

ChunkingResult ChunkerService::chunkDocument(
    const ExtractionResult& extraction
) const {
    ChunkingResult result;

    if (!extraction.is_successful) {
        result.error = extraction.error.empty()
            ? "Cannot chunk an unsuccessful extraction result."
            : "Extraction failed: " + extraction.error;
        return result;
    }

    if (extraction.document.type != DocumentNodeType::Document) {
        result.error = "Extraction result does not contain a document root.";
        return result;
    }

    if (config_.max_chunk_tokens == 0) {
        result.error =
            "The configured maximum chunk token limit must be greater than zero.";
        return result;
    }

    if (!token_counter_) {
        result.error =
            "No tokenizer token-counting function was supplied. "
            "Provide the exact tokenizer used by the embedding model.";
        return result;
    }

    try {
        ChunkBuilder builder(
            config_.max_chunk_tokens, token_counter_, result.chunks
        );
        std::vector<std::string> heading_path;
        traverse(extraction.document, heading_path, builder);
        result.is_successful = true;
    } catch (const std::exception& exception) {
        result.chunks.clear();
        result.error = std::string("Chunking failed: ") + exception.what();
    } catch (...) {
        result.chunks.clear();
        result.error =
            "Chunking failed due to an unknown tokenizer or processing error.";
    }

    return result;
}

} // namespace rag
