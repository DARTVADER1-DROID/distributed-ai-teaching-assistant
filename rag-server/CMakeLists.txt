cmake_minimum_required(VERSION 3.25)

project(distributed_ai_teaching_assistant_rag LANGUAGES CXX)

include(CTest)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_subdirectory(validator)
add_subdirectory(extractor)
add_subdirectory(chunker)
add_subdirectory(pipeline-test)
