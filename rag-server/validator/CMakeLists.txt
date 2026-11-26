cmake_minimum_required(VERSION 3.16)

project(rag_validator LANGUAGES CXX)

find_package(unofficial-poppler CONFIG REQUIRED)

add_library(rag_validator
    validator_service.cpp
    font_size_validator.cpp
    heading_level_validator.cpp
    page_limit_validator.cpp
)

target_compile_features(rag_validator PUBLIC cxx_std_17)

target_include_directories(rag_validator
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}
)

target_link_libraries(rag_validator
    PRIVATE
        unofficial::poppler::poppler-cpp
)

if(MSVC)
    target_compile_options(rag_validator PRIVATE /W4 /permissive-)
else()
    target_compile_options(rag_validator PRIVATE -Wall -Wextra -Wpedantic)
endif()
