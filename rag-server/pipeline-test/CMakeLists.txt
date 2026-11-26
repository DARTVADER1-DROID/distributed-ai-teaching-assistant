cmake_minimum_required(VERSION 3.21)

project(rag_pipeline_test LANGUAGES CXX)

add_subdirectory(../validator validator)
add_subdirectory(../extractor extractor)
add_subdirectory(../chunker chunker)
add_subdirectory(../embedding-service embedding-service)

add_executable(rag_pipeline_test
    main.cpp
)

target_compile_features(rag_pipeline_test PRIVATE cxx_std_17)

target_link_libraries(rag_pipeline_test
    PRIVATE
        rag_validator
        rag_extractor
        rag_chunker
        rag_embedding_service
)

rag_copy_embedding_runtime(rag_pipeline_test)
