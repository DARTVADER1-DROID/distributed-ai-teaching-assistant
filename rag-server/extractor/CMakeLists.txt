cmake_minimum_required(VERSION 3.16)

project(rag_extractor LANGUAGES CXX)

find_package(unofficial-poppler CONFIG REQUIRED)

add_library(rag_extractor
    extractor_service.cpp
)

target_compile_features(rag_extractor PUBLIC cxx_std_17)

target_include_directories(rag_extractor
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}
)

target_link_libraries(rag_extractor
    PRIVATE
        unofficial::poppler::poppler-cpp
)

if(MSVC)
    target_compile_options(rag_extractor PRIVATE /W4 /permissive-)
else()
    target_compile_options(rag_extractor PRIVATE -Wall -Wextra -Wpedantic)
endif()
