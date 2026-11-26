#include "validator_service.hpp"
#include "extractor_service.hpp"
#include "chunker_service.hpp"
#include "embedding_service.hpp"

#include <chrono>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <memory>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

namespace {

using SteadyClock = std::chrono::steady_clock;

struct StageTiming {
    std::string name;
    SteadyClock::duration elapsed;
};

template <typename Callable>
auto measureStage(
    std::vector<StageTiming>& timings,
    const std::string& name,
    Callable&& callable
) -> std::invoke_result_t<Callable> {
    const auto start = SteadyClock::now();

    try {
        if constexpr (std::is_void_v<std::invoke_result_t<Callable>>) {
            std::forward<Callable>(callable)();
            timings.push_back({name, SteadyClock::now() - start});
        } else {
            auto result = std::forward<Callable>(callable)();
            timings.push_back({name, SteadyClock::now() - start});
            return result;
        }
    } catch (...) {
        timings.push_back({name, SteadyClock::now() - start});
        throw;
    }
}

double toMilliseconds(SteadyClock::duration duration) {
    return std::chrono::duration<double, std::milli>(duration).count();
}

void printTimingReport(
    const std::vector<StageTiming>& timings,
    SteadyClock::time_point program_start
) {
    std::cout << "\n========================================\n"
              << " EXECUTION TIMINGS\n"
              << "========================================\n";

    if (timings.empty()) {
        std::cout << "No processing stages were executed.\n";
    } else {
        for (const auto& timing : timings) {
            std::cout << std::left << std::setw(30)
                      << timing.name << std::right
                      << std::fixed << std::setprecision(3)
                      << toMilliseconds(timing.elapsed) << " ms\n";
        }
    }

    std::cout << "----------------------------------------\n"
              << std::left << std::setw(30)
              << "TOTAL PROGRAM TIME" << std::right
              << std::fixed << std::setprecision(3)
              << toMilliseconds(SteadyClock::now() - program_start)
              << " ms\n"
              << "========================================\n"
              << "Times use a monotonic high-resolution clock.\n";
}

void printSourcePosition(std::size_t page_number, std::size_t line_number) {
    std::cout << "Page " << page_number << ", Line " << line_number;
}

void printTree(const rag::DocumentNode& node, std::size_t depth = 0) {
    const std::string indent(depth * 2, ' ');

    if (node.type == rag::DocumentNodeType::Document) {
        std::cout << indent << "Document (" << node.page_count << " pages)\n";
    } else if (node.type == rag::DocumentNodeType::Heading) {
        std::cout << indent << "H" << node.heading_level << ": "
                  << node.text << " [page " << node.page_number
                  << ", line " << node.line_number << "]\n";
    } else {
        const std::size_t end_page =
            node.end_page_number != 0 ? node.end_page_number : node.page_number;
        const std::size_t end_line =
            node.end_line_number != 0 ? node.end_line_number : node.line_number;

        std::cout << indent << "Paragraph: " << node.text << " [";
        printSourcePosition(node.page_number, node.line_number);
        std::cout << " - ";
        printSourcePosition(end_page, end_line);
        std::cout << "]\n";
    }

    for (const auto& child : node.children) {
        printTree(child, depth + 1);
    }
}

bool readPdf(const std::string& path, std::vector<std::uint8_t>& bytes) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        std::cerr << "ERROR: Cannot open PDF: " << path << '\n';
        return false;
    }

    bytes.assign(
        std::istreambuf_iterator<char>(input),
        std::istreambuf_iterator<char>()
    );

    if (input.bad()) {
        std::cerr << "ERROR: Failed while reading PDF: " << path << '\n';
        return false;
    }
    if (bytes.empty()) {
        std::cerr << "ERROR: The selected PDF is empty.\n";
        return false;
    }
    return true;
}

void printHeadingPath(const std::vector<std::string>& heading_path) {
    if (heading_path.empty()) {
        std::cout << "(document root)";
        return;
    }

    for (std::size_t i = 0; i < heading_path.size(); ++i) {
        if (i != 0) {
            std::cout << " > ";
        }
        std::cout << heading_path[i];
    }
}

double calculateL2Norm(const std::vector<float>& values) {
    double squared_sum = 0.0;
    for (const float value : values) {
        squared_sum += static_cast<double>(value) * value;
    }
    return std::sqrt(squared_sum);
}

void printEmbeddingVector(const std::vector<float>& values) {
    std::cout << "Dense vector values (" << values.size()
              << " dimensions):\n";

    constexpr std::size_t values_per_line = 8;
    for (std::size_t i = 0; i < values.size(); ++i) {
        if (i % values_per_line == 0) {
            std::cout << "  [" << std::setw(4) << i << "] ";
        }

        std::cout << std::fixed << std::setprecision(6) << values[i];

        if (i + 1 < values.size()) {
            std::cout << ", ";
        }
        if ((i + 1) % values_per_line == 0 || i + 1 == values.size()) {
            std::cout << '\n';
        }
    }
}

} // namespace

int main(int argc, char* argv[]) {
    const auto program_start = SteadyClock::now();
    std::vector<StageTiming> timings;

    if (argc != 4) {
        std::cerr << "Usage:\n"
                  << "  rag_pipeline_test.exe <path-to-pdf> "
                     "<path-to-model.onnx> <path-to-tokenizer.json>\n\n"
                  << "Example:\n"
                  << "  rag_pipeline_test.exe \"C:\\Users\\You\\Documents\\sample.pdf\" "
                     "\"C:\\rag\\models\\bge-m3\\model.onnx\" "
                     "\"C:\\rag\\models\\bge-m3\\tokenizer.json\"\n";
        printTimingReport(timings, program_start);
        return 2;
    }

    const std::string pdf_path = argv[1];
    const std::string model_path = argv[2];
    const std::string tokenizer_path = argv[3];
    std::vector<std::uint8_t> pdf_bytes;

    std::cout << "========================================\n"
              << " RAG PDF VALIDATION + EXTRACTION + CHUNKING + EMBEDDING TEST\n"
              << "========================================\n"
              << "PDF: " << pdf_path << '\n'
              << "Model: " << model_path << '\n'
              << "Tokenizer: " << tokenizer_path << "\n\n";

    const bool pdf_read = measureStage(timings, "PDF file read", [&] {
        return readPdf(pdf_path, pdf_bytes);
    });
    if (!pdf_read) {
        printTimingReport(timings, program_start);
        return 2;
    }

    rag::DocumentFormatConfig format_config;
    rag::ValidatorConfig validator_config;
    std::unique_ptr<rag::ValidatorService> validator;

    measureStage(timings, "Configuration + validator setup", [&] {
        static_cast<rag::DocumentFormatConfig&>(validator_config) = format_config;
        validator = std::make_unique<rag::ValidatorService>(validator_config);
    });

    std::cout << "[1/4] VALIDATION\n"
              << "----------------------------------------\n";

    const rag::ValidationReport validation =
        measureStage(timings, "PDF validation", [&] {
            return validator->validatePdf(pdf_bytes);
        });

    if (!validation.isValid()) {
        measureStage(timings, "Validation error reporting", [&] {
            std::cout << "RESULT: FAILED (" << validation.issues.size()
                      << " issue(s))\n\n";

            for (std::size_t i = 0; i < validation.issues.size(); ++i) {
                const auto& issue = validation.issues[i];
                std::cout << (i + 1) << ". " << issue.reason << '\n';

                if (issue.page_number > 0) {
                    std::cout << "   Page: " << issue.page_number << '\n';
                }
                if (issue.line_number > 0) {
                    std::cout << "   Line: " << issue.line_number << '\n';
                }
                if (issue.word_count > 0) {
                    std::cout << "   Word count: " << issue.word_count << '\n';
                }
                if (!issue.line_text.empty()) {
                    std::cout << "   Text: " << issue.line_text << '\n';
                }
            }

            std::cout << "\nExtraction, chunking and embedding were not started "
                         "because validation failed.\n";
        });

        printTimingReport(timings, program_start);
        return 1;
    }

    std::cout << "RESULT: PASSED\n"
              << "No validation rule violations were reported.\n\n";

    std::unique_ptr<rag::ExtractorService> extractor;
    measureStage(timings, "Extractor initialization", [&] {
        extractor = std::make_unique<rag::ExtractorService>(format_config);
    });

    std::cout << "[2/4] HIERARCHICAL EXTRACTION\n"
              << "----------------------------------------\n";

    const rag::ExtractionResult extraction =
        measureStage(timings, "Hierarchical extraction", [&] {
            return extractor->extractPdf(pdf_bytes);
        });

    if (!extraction.is_successful) {
        std::cout << "RESULT: FAILED\n"
                  << "Reason: " << extraction.error << '\n';
        printTimingReport(timings, program_start);
        return 1;
    }

    std::cout << "RESULT: PASSED\n\n"
              << "Extracted document tree:\n";
    measureStage(timings, "Extracted tree rendering", [&] {
        printTree(extraction.document);
    });

    rag::EmbeddingConfig embedding_config;
    embedding_config.model_path = model_path;
    embedding_config.tokenizer_path = tokenizer_path;

    std::unique_ptr<rag::EmbeddingService> embedding_service;
    measureStage(timings, "Embedding service construction", [&] {
        embedding_service =
            std::make_unique<rag::EmbeddingService>(embedding_config);
    });

    std::cout << "\n[3/4] BGE-M3 INITIALIZATION\n"
              << "----------------------------------------\n";

    const rag::EmbeddingOperationResult initialization =
        measureStage(timings, "BGE-M3 model + tokenizer load", [&] {
            return embedding_service->initialize();
        });

    if (!initialization.is_successful) {
        std::cout << "RESULT: FAILED\n"
                  << "Reason: " << initialization.error << '\n';
        printTimingReport(timings, program_start);
        return 1;
    }

    std::cout << "RESULT: PASSED\n"
              << "Local model and tokenizer loaded successfully.\n"
              << "Runtime mode: ONNX Runtime CPU\n"
              << "Embedding dimensions: 1024\n"
              << "Maximum sequence length: "
              << embedding_config.max_sequence_length << " tokens\n\n";

    rag::ChunkerConfig chunker_config;
    const rag::TokenCounter bge_tokenizer = [&](const std::string& text) {
        return embedding_service->countTokens(text);
    };

    std::unique_ptr<rag::ChunkerService> chunker;
    measureStage(timings, "Chunker initialization", [&] {
        chunker = std::make_unique<rag::ChunkerService>(
            chunker_config, bge_tokenizer
        );
    });

    std::cout << "[4/4] STRUCTURE-AWARE CHUNKING + EMBEDDING\n"
              << "----------------------------------------\n"
              << "Configured maximum: " << chunker_config.max_chunk_tokens
              << " BGE-M3 tokens\n"
              << "Tokenizer: BGE-M3 tokenizer.json\n\n";

    const rag::ChunkingResult chunking =
        measureStage(timings, "Structure-aware chunking", [&] {
            return chunker->chunkDocument(extraction);
        });

    if (!chunking.is_successful) {
        std::cout << "CHUNKING RESULT: FAILED\n"
                  << "Reason: " << chunking.error << '\n';
        printTimingReport(timings, program_start);
        return 1;
    }

    std::cout << "CHUNKING RESULT: PASSED\n"
              << "Generated chunks: " << chunking.chunks.size() << "\n\n";

    std::vector<std::size_t> chunk_token_counts;
    const bool token_limit_ok =
        measureStage(timings, "BGE token-limit verification", [&] {
            chunk_token_counts.reserve(chunking.chunks.size());
            for (const auto& chunk : chunking.chunks) {
                const std::size_t token_count =
                    embedding_service->countTokens(chunk.embedding_text);
                chunk_token_counts.push_back(token_count);

                if (token_count > chunker_config.max_chunk_tokens) {
                    return false;
                }
            }
            return true;
        });

    measureStage(timings, "Chunk result rendering", [&] {
        for (std::size_t i = 0; i < chunking.chunks.size(); ++i) {
            const auto& chunk = chunking.chunks[i];
            const std::size_t token_count = chunk_token_counts[i];

            std::cout << "========================================\n"
                      << "CHUNK " << chunk.index << '\n'
                      << "========================================\n"
                      << "Heading path: ";
            printHeadingPath(chunk.heading_path);

            std::cout << "\nBGE-M3 token count: " << token_count
                      << " / " << chunker_config.max_chunk_tokens
                      << (token_count <= chunker_config.max_chunk_tokens
                              ? " [OK]\n"
                              : " [LIMIT EXCEEDED]\n");

            std::cout << "\nSource start: ";
            printSourcePosition(
                chunk.start_page_number, chunk.start_line_number
            );
            std::cout << "\nSource end:   ";
            printSourcePosition(
                chunk.end_page_number, chunk.end_line_number
            );
            std::cout << "\n\n"
                      << "Original chunk text:\n"
                      << chunk.text << "\n\n"
                      << "Embedding input (heading context + text):\n"
                      << chunk.embedding_text << "\n\n";
        }
    });

    if (!token_limit_ok) {
        std::cout << "CHUNKING CHECK: FAILED - a chunk exceeded the "
                     "configured BGE-M3 token limit.\n";
        printTimingReport(timings, program_start);
        return 1;
    }

    std::cout << "CHUNKING CHECK: PASSED - all chunks are within the "
                 "configured BGE-M3 token limit.\n\n";

    std::vector<rag::EmbeddingResult> embeddings;
    const bool embedding_generation_ok =
        measureStage(timings, "Embedding generation (all chunks)", [&] {
            embeddings.reserve(chunking.chunks.size());

            for (const auto& chunk : chunking.chunks) {
                rag::EmbeddingResult result =
                    embedding_service->embedText(chunk.embedding_text);

                if (!result.is_successful) {
                    std::cout << "EMBEDDING RESULT: FAILED for chunk "
                              << chunk.index << '\n'
                              << "Reason: " << result.error << '\n';
                    return false;
                }

                embeddings.push_back(std::move(result));
            }
            return true;
        });

    if (!embedding_generation_ok) {
        printTimingReport(timings, program_start);
        return 1;
    }

    measureStage(timings, "Embedding result rendering", [&] {
            for (std::size_t i = 0; i < embeddings.size(); ++i) {
                const auto& vector = embeddings[i].dense_vector;
                const double norm = calculateL2Norm(vector);

                std::cout << "========================================\n"
                          << "EMBEDDING FOR CHUNK "
                          << chunking.chunks[i].index << '\n'
                          << "========================================\n"
                          << "Dimensions: " << vector.size() << '\n'
                          << "L2 norm: " << std::fixed << std::setprecision(8)
                          << norm << '\n'
                          << "Normalization check: "
                          << (std::abs(norm - 1.0) <= 1.0e-4
                                  ? "PASSED"
                                  : "FAILED")
                          << "\n\n";
                printEmbeddingVector(vector);
                std::cout << '\n';
            }
    });

    for (const auto& embedding : embeddings) {
        if (embedding.dense_vector.size() != 1024 ||
            std::abs(calculateL2Norm(embedding.dense_vector) - 1.0) > 1.0e-4) {
            std::cout << "EMBEDDING CHECK: FAILED - unexpected vector "
                         "dimensions or non-normalized output.\n";
            printTimingReport(timings, program_start);
            return 1;
        }
    }

    std::cout << "EMBEDDING CHECK: PASSED - generated "
              << embeddings.size()
              << " normalized 1024-dimensional vector(s).\n"
              << "\n========================================\n"
              << " PIPELINE COMPLETED SUCCESSFULLY\n"
              << "========================================\n";

    printTimingReport(timings, program_start);
    return 0;
}
