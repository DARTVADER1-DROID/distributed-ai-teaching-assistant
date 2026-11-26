cmake_minimum_required(VERSION 3.16)

project(rag_pipeline_test LANGUAGES CXX)

add_subdirectory(../validator validator)
add_subdirectory(../extractor extractor)

add_executable(rag_pipeline_test
    main.cpp
)

target_compile_features(rag_pipeline_test PRIVATE cxx_std_17)

target_link_libraries(rag_pipeline_test
    PRIVATE
        rag_validator
        rag_extractor
)
