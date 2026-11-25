cmake_minimum_required(VERSION 3.16)

project(rag_validator LANGUAGES CXX)

find_package(PkgConfig REQUIRED)
pkg_check_modules(POPPLER_CPP REQUIRED IMPORTED_TARGET poppler-cpp>=0.89)
pkg_check_modules(POPPLER REQUIRED IMPORTED_TARGET poppler)

add_library(rag_validator
    validator_service.cpp
)

target_compile_features(rag_validator PUBLIC cxx_std_17)

target_include_directories(rag_validator
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}
)

target_link_libraries(rag_validator
    PRIVATE
        PkgConfig::POPPLER_CPP
        PkgConfig::POPPLER
)
