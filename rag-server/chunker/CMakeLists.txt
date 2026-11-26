cmake_minimum_required(VERSION 3.16)

project(rag_chunker LANGUAGES CXX)

add_library(rag_chunker
    chunker_service.cpp
)

target_compile_features(rag_chunker PUBLIC cxx_std_17)

target_include_directories(rag_chunker
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}
        ${CMAKE_CURRENT_SOURCE_DIR}/../config
        ${CMAKE_CURRENT_SOURCE_DIR}/../extractor
)
