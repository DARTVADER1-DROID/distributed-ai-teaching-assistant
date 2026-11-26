#include "embedding_service.hpp"

#include <onnxruntime_cxx_api.h>
#include <tokenizers_cpp.h>

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <limits>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <utility>

namespace rag {
namespace {

constexpr std::size_t kBgeM3EmbeddingDimensions = 1024;

std::string readFile(const std::filesystem::path& path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw std::runtime_error("Unable to open file: " + path.string());
    }

    std::ostringstream contents;
    contents << input.rdbuf();
    if (!input.good() && !input.eof()) {
        throw std::runtime_error("Unable to read file: " + path.string());
    }
    return contents.str();
}

std::string describeException(const std::exception& exception) {
    return exception.what();
}

} // namespace

class EmbeddingService::Implementation {
public:
    explicit Implementation(EmbeddingConfig config)
        : config_(std::move(config)),
          environment_(ORT_LOGGING_LEVEL_WARNING, "rag-bge-m3") {}

    EmbeddingOperationResult initialize() {
        EmbeddingOperationResult result;

        try {
            if (config_.model_path.empty()) {
                throw std::runtime_error("The BGE-M3 ONNX model path is empty.");
            }
            if (config_.tokenizer_path.empty()) {
                throw std::runtime_error("The BGE-M3 tokenizer path is empty.");
            }
            if (config_.max_sequence_length == 0) {
                throw std::runtime_error(
                    "The maximum sequence length must be greater than zero."
                );
            }
            if (config_.intra_op_threads < 0) {
                throw std::runtime_error(
                    "The ONNX Runtime thread count cannot be negative."
                );
            }

            const std::string tokenizer_json = readFile(config_.tokenizer_path);
            tokenizer_ = tokenizers::Tokenizer::FromBlobJSON(tokenizer_json);
            if (!tokenizer_) {
                throw std::runtime_error(
                    "The BGE-M3 tokenizer could not be loaded from tokenizer.json."
                );
            }

            Ort::SessionOptions session_options;
            session_options.SetGraphOptimizationLevel(
                GraphOptimizationLevel::ORT_ENABLE_ALL
            );
            if (config_.intra_op_threads > 0) {
                session_options.SetIntraOpNumThreads(config_.intra_op_threads);
            }

            // No execution provider is appended: ONNX Runtime's CPU provider
            // is the deliberate, dependency-light offline baseline.
            session_ = std::make_unique<Ort::Session>(
                environment_,
                config_.model_path.c_str(),
                session_options
            );

            inspectModelContract();
            initialized_ = true;
            result.is_successful = true;
        } catch (const std::exception& exception) {
            session_.reset();
            tokenizer_.reset();
            result.error = "BGE-M3 initialization failed: " +
                           describeException(exception);
        } catch (...) {
            session_.reset();
            tokenizer_.reset();
            result.error =
                "BGE-M3 initialization failed due to an unknown error.";
        }

        return result;
    }

    EmbeddingResult embedText(const std::string& text) const {
        EmbeddingResult result;

        try {
            ensureInitialized();
            if (text.empty()) {
                throw std::runtime_error("Cannot embed empty text.");
            }

            std::vector<int32_t> token_ids;
            {
                // The tokenizer implementation is shared by the chunker's
                // token counter and inference. Serialize access to it.
                std::lock_guard<std::mutex> lock(tokenizer_mutex_);
                token_ids = tokenizer_->Encode(text);
            }

            if (token_ids.empty()) {
                throw std::runtime_error(
                    "The tokenizer returned no tokens for the supplied text."
                );
            }
            if (token_ids.size() > config_.max_sequence_length) {
                throw std::runtime_error(
                    "Input contains " + std::to_string(token_ids.size()) +
                    " tokens, exceeding the configured maximum of " +
                    std::to_string(config_.max_sequence_length) +
                    ". The service does not silently truncate embedding input."
                );
            }

            std::vector<int64_t> input_ids;
            input_ids.reserve(token_ids.size());
            for (const int32_t token_id : token_ids) {
                input_ids.push_back(static_cast<int64_t>(token_id));
            }

            std::vector<int64_t> attention_mask(input_ids.size(), 1);
            std::vector<int64_t> token_type_ids(input_ids.size(), 0);

            const std::array<int64_t, 2> input_shape{
                1, static_cast<int64_t>(input_ids.size())
            };
            const auto memory_info = Ort::MemoryInfo::CreateCpu(
                OrtArenaAllocator, OrtMemTypeDefault
            );

            std::vector<Ort::Value> input_values;
            input_values.reserve(input_names_.size());

            for (const auto& input_name : input_names_) {
                if (input_name == "input_ids") {
                    input_values.push_back(Ort::Value::CreateTensor<int64_t>(
                        memory_info,
                        input_ids.data(),
                        input_ids.size(),
                        input_shape.data(),
                        input_shape.size()
                    ));
                } else if (input_name == "attention_mask") {
                    input_values.push_back(Ort::Value::CreateTensor<int64_t>(
                        memory_info,
                        attention_mask.data(),
                        attention_mask.size(),
                        input_shape.data(),
                        input_shape.size()
                    ));
                } else if (input_name == "token_type_ids") {
                    input_values.push_back(Ort::Value::CreateTensor<int64_t>(
                        memory_info,
                        token_type_ids.data(),
                        token_type_ids.size(),
                        input_shape.data(),
                        input_shape.size()
                    ));
                } else {
                    throw std::runtime_error(
                        "Unsupported required ONNX input: " + input_name
                    );
                }
            }

            std::vector<const char*> input_name_pointers;
            input_name_pointers.reserve(input_names_.size());
            for (const auto& name : input_names_) {
                input_name_pointers.push_back(name.c_str());
            }

            std::vector<const char*> output_name_pointers;
            output_name_pointers.reserve(output_names_.size());
            for (const auto& name : output_names_) {
                output_name_pointers.push_back(name.c_str());
            }

            auto outputs = session_->Run(
                Ort::RunOptions{nullptr},
                input_name_pointers.data(),
                input_values.data(),
                input_values.size(),
                output_name_pointers.data(),
                output_name_pointers.size()
            );

            const Ort::Value* dense_output = nullptr;
            bool output_is_token_sequence = false;

            // Support the common BGE-M3 ONNX export contracts:
            //  - a ready-made dense sentence vector [1, 1024]
            //  - encoder hidden states [1, sequence, 1024], pooled from CLS.
            // Prefer a 2-D dense output if the graph exposes both.
            for (const auto& output : outputs) {
                if (!output.IsTensor()) {
                    continue;
                }

                const auto tensor_info = output.GetTensorTypeAndShapeInfo();
                if (tensor_info.GetElementType() !=
                    ONNX_TENSOR_ELEMENT_DATA_TYPE_FLOAT) {
                    continue;
                }

                const auto shape = tensor_info.GetShape();
                if (shape.size() == 2 &&
                    shape[0] == 1 &&
                    shape[1] == static_cast<int64_t>(kBgeM3EmbeddingDimensions)) {
                    dense_output = &output;
                    output_is_token_sequence = false;
                    break;
                }

                if (shape.size() == 3 &&
                    shape[0] == 1 &&
                    shape[1] >= 1 &&
                    shape[2] ==
                        static_cast<int64_t>(kBgeM3EmbeddingDimensions) &&
                    dense_output == nullptr) {
                    dense_output = &output;
                    output_is_token_sequence = true;
                }
            }

            if (dense_output == nullptr) {
                throw std::runtime_error(
                    "The ONNX model did not expose a supported float dense "
                    "output. Expected [1, 1024] or [1, sequence, 1024]."
                );
            }

            const float* output_data =
                dense_output->GetTensorData<float>();
            if (output_data == nullptr) {
                throw std::runtime_error("The ONNX dense output is empty.");
            }

            result.dense_vector.resize(kBgeM3EmbeddingDimensions);
            const std::size_t source_offset =
                output_is_token_sequence ? 0 : 0;
            std::copy_n(
                output_data + source_offset,
                kBgeM3EmbeddingDimensions,
                result.dense_vector.begin()
            );

            // Normalize here regardless of the export's pooling head. This
            // guarantees a consistent cosine-similarity vector for Qdrant.
            double squared_norm = 0.0;
            for (const float value : result.dense_vector) {
                if (!std::isfinite(value)) {
                    throw std::runtime_error(
                        "The ONNX model produced a non-finite embedding value."
                    );
                }
                squared_norm += static_cast<double>(value) * value;
            }

            const double norm = std::sqrt(squared_norm);
            if (!std::isfinite(norm) ||
                norm <= std::numeric_limits<double>::epsilon()) {
                throw std::runtime_error(
                    "The ONNX model produced a zero-length dense embedding."
                );
            }

            for (float& value : result.dense_vector) {
                value = static_cast<float>(value / norm);
            }

            result.is_successful = true;
        } catch (const std::exception& exception) {
            result.dense_vector.clear();
            result.error = "BGE-M3 embedding failed: " +
                           describeException(exception);
        } catch (...) {
            result.dense_vector.clear();
            result.error =
                "BGE-M3 embedding failed due to an unknown error.";
        }

        return result;
    }

    std::size_t countTokens(const std::string& text) const {
        ensureInitialized();

        std::lock_guard<std::mutex> lock(tokenizer_mutex_);
        return tokenizer_->Encode(text).size();
    }

    bool isInitialized() const noexcept {
        return initialized_;
    }

private:
    void ensureInitialized() const {
        if (!initialized_ || !session_ || !tokenizer_) {
            throw std::runtime_error(
                "EmbeddingService is not initialized. Call initialize() first."
            );
        }
    }

    void inspectModelContract() {
        Ort::AllocatorWithDefaultOptions allocator;
        const std::size_t input_count = session_->GetInputCount();
        const std::size_t output_count = session_->GetOutputCount();

        if (input_count == 0 || output_count == 0) {
            throw std::runtime_error(
                "The ONNX model must expose at least one input and one output."
            );
        }

        bool has_input_ids = false;
        for (std::size_t index = 0; index < input_count; ++index) {
            auto name = session_->GetInputNameAllocated(index, allocator);
            const std::string input_name = name.get();
            input_names_.push_back(input_name);

            if (input_name == "input_ids") {
                has_input_ids = true;
            } else if (input_name != "attention_mask" &&
                       input_name != "token_type_ids") {
                throw std::runtime_error(
                    "Unsupported required ONNX input: " + input_name
                );
            }
        }

        if (!has_input_ids) {
            throw std::runtime_error(
                "The ONNX model does not expose the required input_ids input."
            );
        }

        for (std::size_t index = 0; index < output_count; ++index) {
            auto name = session_->GetOutputNameAllocated(index, allocator);
            output_names_.push_back(name.get());
        }
    }

    EmbeddingConfig config_;
    Ort::Env environment_;
    std::unique_ptr<Ort::Session> session_;
    std::unique_ptr<tokenizers::Tokenizer> tokenizer_;
    std::vector<std::string> input_names_;
    std::vector<std::string> output_names_;
    mutable std::mutex tokenizer_mutex_;
    bool initialized_ = false;
};

EmbeddingService::EmbeddingService(EmbeddingConfig config)
    : implementation_(
          std::make_unique<Implementation>(std::move(config))
      ) {}

EmbeddingService::~EmbeddingService() = default;
EmbeddingService::EmbeddingService(EmbeddingService&&) noexcept = default;
EmbeddingService& EmbeddingService::operator=(EmbeddingService&&) noexcept = default;

EmbeddingOperationResult EmbeddingService::initialize() {
    if (!implementation_) {
        return {false, "EmbeddingService has no implementation."};
    }
    return implementation_->initialize();
}

EmbeddingResult EmbeddingService::embedText(const std::string& text) const {
    if (!implementation_) {
        return {false, "EmbeddingService has no implementation.", {}};
    }
    return implementation_->embedText(text);
}

std::size_t EmbeddingService::countTokens(const std::string& text) const {
    if (!implementation_) {
        throw std::runtime_error("EmbeddingService has no implementation.");
    }
    return implementation_->countTokens(text);
}

bool EmbeddingService::isInitialized() const noexcept {
    return implementation_ && implementation_->isInitialized();
}

} // namespace rag
