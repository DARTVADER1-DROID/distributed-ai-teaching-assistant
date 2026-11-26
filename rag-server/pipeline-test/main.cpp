#include "validator_service.hpp"
#include "extractor_service.hpp"
#include "chunker_service.hpp"

#include <chrono>
#include <cstdint>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <iterator>
#include <memory>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#include <vector>

namespace {

using SteadyClock = std::chrono::steady_clock;
std::streambuf* protocol_output_buffer = nullptr;
std::streambuf* protocol_output_buffer = nullptr;

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

    for (const auto& timing : timings) {
        std::cout << std::left << std::setw(30)
                  << timing.name << std::right
                  << std::fixed << std::setprecision(3)
                  << toMilliseconds(timing.elapsed) << " ms\n";
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

std::string base64Encode(const std::string& input) {
    static constexpr char alphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string output;
    output.reserve(((input.size() + 2) / 3) * 4);
    for (std::size_t i = 0; i < input.size(); i += 3) {
        const std::uint32_t a = static_cast<unsigned char>(input[i]);
        const std::uint32_t b = i + 1 < input.size() ? static_cast<unsigned char>(input[i + 1]) : 0;
        const std::uint32_t c = i + 2 < input.size() ? static_cast<unsigned char>(input[i + 2]) : 0;
        const std::uint32_t value = (a << 16) | (b << 8) | c;
        output.push_back(alphabet[(value >> 18) & 0x3F]);
        output.push_back(alphabet[(value >> 12) & 0x3F]);
        output.push_back(i + 1 < input.size() ? alphabet[(value >> 6) & 0x3F] : '=');
        output.push_back(i + 2 < input.size() ? alphabet[value & 0x3F] : '=');
    }
    return output;
}

std::size_t requestTokenCount(const std::string& text) {
    auto* current_output = std::cout.rdbuf();
    std::cout.rdbuf(protocol_output_buffer);
    std::cout << "TOKENIZE\t" << base64Encode(text) << '\n' << std::flush;
    std::cout.rdbuf(current_output);
    std::string response;
    if (!std::getline(std::cin, response) || response.rfind("COUNT\t", 0) != 0)
        throw std::runtime_error("Tokenizer host disconnected or returned an invalid response.");
    const std::string count_text = response.substr(6);
    std::size_t consumed = 0;
    const unsigned long long count = std::stoull(count_text, &consumed);
    if (consumed != count_text.size())
        throw std::runtime_error("Tokenizer host returned an invalid token count.");
    return static_cast<std::size_t>(count);
}

void emitChunkProtocol(const rag::DocumentChunk& chunk) {
    std::cout << "CHUNK\t" << chunk.index << '\t' << base64Encode(chunk.text)
              << '\t' << base64Encode(chunk.embedding_text)
              << '\t' << chunk.heading_path.size();
    for (const auto& heading : chunk.heading_path)
        std::cout << '\t' << base64Encode(heading);
    std::cout << '\t' << chunk.start_page_number << '\t' << chunk.start_line_number
              << '\t' << chunk.end_page_number << '\t' << chunk.end_line_number
              << '\n' << std::flush;
}

} // namespace

int main(int argc, char* argv[]) {
    protocol_output_buffer = std::cout.rdbuf();
    std::cout.rdbuf(std::cerr.rdbuf());
    const auto program_start = SteadyClock::now();
    std::vector<StageTiming> timings;

    if (argc != 2) {
        std::cerr << "Usage:\n"
                  << "  rag_pipeline_test.exe <path-to-pdf>\n\n"
                  << "Example:\n"
                  << "  rag_pipeline_test.exe \"C:\\Users\\You\\Documents\\sample.pdf\"\n";
        printTimingReport(timings, program_start);
        return 2;
    }

    const std::string pdf_path = argv[1];
    std::vector<std::uint8_t> pdf_bytes;

    std::cout << "========================================\n"
              << " RAG PDF VALIDATION + EXTRACTION + CHUNKING TEST\n"
              << "========================================\n"
              << "PDF: " << pdf_path << "\n\n";

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

    std::cout << "[1/3] VALIDATION\n"
              << "----------------------------------------\n";

    const rag::ValidationReport validation =
        measureStage(timings, "PDF validation", [&] {
            return validator->validatePdf(pdf_bytes);
        });

    if (!validation.isValid()) {
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

        std::cout << "\nExtraction and chunking were not started because "
                     "validation failed.\n";
        printTimingReport(timings, program_start);
        return 1;
    }

    std::cout << "RESULT: PASSED\n"
              << "No validation rule violations were reported.\n\n";

    std::unique_ptr<rag::ExtractorService> extractor;
    measureStage(timings, "Extractor initialization", [&] {
        extractor = std::make_unique<rag::ExtractorService>(format_config);
    });

    std::cout << "[2/3] HIERARCHICAL EXTRACTION\n"
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

    rag::ChunkerConfig chunker_config;
    const rag::TokenCounter test_counter = requestTokenCount;

    std::unique_ptr<rag::ChunkerService> chunker;
    measureStage(timings, "Chunker initialization", [&] {
        chunker = std::make_unique<rag::ChunkerService>(
            chunker_config, test_counter
        );
    });

    std::cout << "\n[3/3] STRUCTURE-AWARE CHUNKING\n"
              << "----------------------------------------\n"
              << "Configured maximum: " << chunker_config.max_chunk_tokens
              << " BGE-M3 tokenizer tokens\n\n";

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

    measureStage(timings, "Chunk result rendering", [&] {
        for (const auto& chunk : chunking.chunks) {
            const std::size_t count = requestTokenCount(chunk.embedding_text);

            std::cout << "========================================\n"
                      << "CHUNK " << chunk.index << '\n'
                      << "========================================\n"
                      << "Heading path: ";
            printHeadingPath(chunk.heading_path);

            std::cout << "\nBGE-M3 token count: " << count
                      << " / " << chunker_config.max_chunk_tokens << '\n'
                      << "Source start: ";
            printSourcePosition(
                chunk.start_page_number, chunk.start_line_number
            );
            std::cout << "\nSource end:   ";
            printSourcePosition(
                chunk.end_page_number, chunk.end_line_number
            );
            std::cout << "\n\nChunk text:\n"
                      << chunk.text << "\n\n"
                      << "Chunk input with heading context:\n"
                      << chunk.embedding_text << "\n\n";
        }
    });

    std::cout << "CHUNKING CHECK: PASSED\\n"
              << "Chunk boundaries were calculated with the BGE-M3 tokenizer.\\n"
              << "Sending chunks to the C# embedding host...\\n";

    std::cout.rdbuf(protocol_output_buffer);
    for (const auto& chunk : chunking.chunks)
        emitChunkProtocol(chunk);
    std::cout << "DONE\\n" << std::flush;
    std::cout.rdbuf(std::cerr.rdbuf());

    printTimingReport(timings, program_start);
    return 0;
}
