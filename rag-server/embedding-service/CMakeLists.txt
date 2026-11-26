cmake_minimum_required(VERSION 3.21)

project(rag_embedding_service LANGUAGES C CXX)

include(FetchContent)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# The end-user application is fully offline. These dependencies are acquired
# only while building the application, then bundled with the application.
# No dependency or model download is performed by EmbeddingService at runtime.
set(RAG_ONNXRUNTIME_VERSION "1.32.0" CACHE STRING
    "Pinned ONNX Runtime version used by the embedding service")

set(RAG_ONNXRUNTIME_ROOT
    "${CMAKE_CURRENT_BINARY_DIR}/_deps/onnxruntime"
)
set(RAG_ONNXRUNTIME_PACKAGE
    "${RAG_ONNXRUNTIME_ROOT}/microsoft.ml.onnxruntime.${RAG_ONNXRUNTIME_VERSION}"
)
set(RAG_ONNXRUNTIME_ARCHIVE
    "${CMAKE_CURRENT_BINARY_DIR}/_deps/microsoft.ml.onnxruntime.nupkg"
)

if(NOT EXISTS "${RAG_ONNXRUNTIME_PACKAGE}/build/native/include/onnxruntime_cxx_api.h")
    file(MAKE_DIRECTORY "${RAG_ONNXRUNTIME_ROOT}")

    if(NOT EXISTS "${RAG_ONNXRUNTIME_ARCHIVE}")
        message(STATUS "Downloading pinned ONNX Runtime ${RAG_ONNXRUNTIME_VERSION}")
        file(DOWNLOAD
            "https://api.nuget.org/v3-flatcontainer/microsoft.ml.onnxruntime/${RAG_ONNXRUNTIME_VERSION}/microsoft.ml.onnxruntime.${RAG_ONNXRUNTIME_VERSION}.nupkg"
            "${RAG_ONNXRUNTIME_ARCHIVE}"
            TLS_VERIFY ON
            SHOW_PROGRESS
            STATUS RAG_ONNXRUNTIME_DOWNLOAD_STATUS
        )
        list(GET RAG_ONNXRUNTIME_DOWNLOAD_STATUS 0 RAG_ONNXRUNTIME_DOWNLOAD_CODE)
        if(NOT RAG_ONNXRUNTIME_DOWNLOAD_CODE EQUAL 0)
            list(GET RAG_ONNXRUNTIME_DOWNLOAD_STATUS 1 RAG_ONNXRUNTIME_DOWNLOAD_MESSAGE)
            message(FATAL_ERROR
                "ONNX Runtime download failed: ${RAG_ONNXRUNTIME_DOWNLOAD_MESSAGE}"
            )
        endif()
    endif()

    file(MAKE_DIRECTORY "${RAG_ONNXRUNTIME_PACKAGE}")
    file(ARCHIVE_EXTRACT
        INPUT "${RAG_ONNXRUNTIME_ARCHIVE}"
        DESTINATION "${RAG_ONNXRUNTIME_PACKAGE}"
    )
endif()

if(NOT EXISTS "${RAG_ONNXRUNTIME_PACKAGE}/build/native/include/onnxruntime_cxx_api.h")
    message(FATAL_ERROR
        "The downloaded ONNX Runtime package is incomplete or has an unexpected layout."
    )
endif()

set(RAG_ONNXRUNTIME_DLL
    "${RAG_ONNXRUNTIME_PACKAGE}/runtimes/win-x64/native/onnxruntime.dll"
)
if(NOT EXISTS "${RAG_ONNXRUNTIME_DLL}")
    message(FATAL_ERROR "ONNX Runtime DLL is missing: ${RAG_ONNXRUNTIME_DLL}")
endif()

# The NuGet package supplies the Windows runtime DLL, but the MinGW pipeline
# needs a GNU import archive rather than an MSVC .lib. Generate that archive
# from the DLL exports at configure time. MSVC builds use the package .lib
# when it is present, or generate one with lib.exe from the same .def file.
set(RAG_ONNXRUNTIME_IMPORT_DIR "${CMAKE_CURRENT_BINARY_DIR}/onnxruntime-import")
file(MAKE_DIRECTORY "${RAG_ONNXRUNTIME_IMPORT_DIR}")

if(MINGW)
    find_program(RAG_GENDEF_EXECUTABLE NAMES gendef REQUIRED)
    find_program(RAG_DLLTOOL_EXECUTABLE NAMES dlltool REQUIRED)

    execute_process(
        COMMAND "${RAG_GENDEF_EXECUTABLE}" "${RAG_ONNXRUNTIME_DLL}"
        WORKING_DIRECTORY "${RAG_ONNXRUNTIME_IMPORT_DIR}"
        RESULT_VARIABLE RAG_GENDEF_RESULT
        OUTPUT_VARIABLE RAG_GENDEF_OUTPUT
        ERROR_VARIABLE RAG_GENDEF_ERROR
    )
    if(NOT RAG_GENDEF_RESULT EQUAL 0)
        message(FATAL_ERROR "gendef failed: ${RAG_GENDEF_ERROR}")
    endif()

    file(GLOB RAG_ONNXRUNTIME_DEF_FILES
        "${RAG_ONNXRUNTIME_IMPORT_DIR}/*.def"
    )
    list(LENGTH RAG_ONNXRUNTIME_DEF_FILES RAG_ONNXRUNTIME_DEF_COUNT)
    if(NOT RAG_ONNXRUNTIME_DEF_COUNT EQUAL 1)
        message(FATAL_ERROR
            "gendef did not produce exactly one ONNX Runtime .def file. "
            "Output: ${RAG_GENDEF_OUTPUT}"
        )
    endif()
    list(GET RAG_ONNXRUNTIME_DEF_FILES 0 RAG_ONNXRUNTIME_DEF)

    set(RAG_ONNXRUNTIME_IMPORT_LIBRARY
        "${RAG_ONNXRUNTIME_IMPORT_DIR}/libonnxruntime.dll.a"
    )
    execute_process(
        COMMAND "${RAG_DLLTOOL_EXECUTABLE}"
            --input-def "${RAG_ONNXRUNTIME_DEF}"
            --dllname onnxruntime.dll
            --output-lib "${RAG_ONNXRUNTIME_IMPORT_LIBRARY}"
        RESULT_VARIABLE RAG_DLLTOOL_RESULT
        OUTPUT_VARIABLE RAG_DLLTOOL_OUTPUT
        ERROR_VARIABLE RAG_DLLTOOL_ERROR
    )
    if(NOT RAG_DLLTOOL_RESULT EQUAL 0 OR
       NOT EXISTS "${RAG_ONNXRUNTIME_IMPORT_LIBRARY}")
        message(FATAL_ERROR
            "Could not create the MinGW ONNX Runtime import library: "
            "${RAG_DLLTOOL_ERROR}"
        )
    endif()
else()
    set(RAG_ONNXRUNTIME_IMPORT_LIBRARY
        "${RAG_ONNXRUNTIME_PACKAGE}/build/native/lib/x64/onnxruntime.lib"
    )
    if(NOT EXISTS "${RAG_ONNXRUNTIME_IMPORT_LIBRARY}")
        message(FATAL_ERROR
            "The ONNX Runtime NuGet package does not contain its MSVC import "
            "library: ${RAG_ONNXRUNTIME_IMPORT_LIBRARY}"
        )
    endif()
endif()

add_library(rag_onnxruntime SHARED IMPORTED GLOBAL)
set_target_properties(rag_onnxruntime PROPERTIES
    IMPORTED_IMPLIB "${RAG_ONNXRUNTIME_IMPORT_LIBRARY}"
    IMPORTED_LOCATION "${RAG_ONNXRUNTIME_DLL}"
    INTERFACE_INCLUDE_DIRECTORIES
        "${RAG_ONNXRUNTIME_PACKAGE}/build/native/include"
)

# tokenizers-cpp reads the Hugging Face tokenizer.json format and includes its
# Rust implementation as a static library. Rust is a build-time requirement
# only; no Rust runtime or Python installation is needed by end users.
set(FETCHCONTENT_UPDATES_DISCONNECTED ON CACHE BOOL
    "Do not update already fetched pinned dependencies" FORCE
)

FetchContent_Declare(tokenizers_cpp
    GIT_REPOSITORY https://github.com/mlc-ai/tokenizers-cpp.git
    GIT_TAG c586c52f93f7b060753bd2388eb96a105cb7374d
    GIT_SUBMODULES_RECURSE TRUE
    GIT_SHALLOW FALSE
)

FetchContent_MakeAvailable(tokenizers_cpp)

add_library(rag_embedding_service
    embedding_service.cpp
)

target_compile_features(rag_embedding_service PUBLIC cxx_std_17)

target_include_directories(rag_embedding_service
    PUBLIC
        ${CMAKE_CURRENT_SOURCE_DIR}
)

target_link_libraries(rag_embedding_service
    PUBLIC
        tokenizers_cpp
        rag_onnxruntime
)

if(MSVC)
    target_compile_options(rag_embedding_service PRIVATE /W4 /permissive-)
else()
    target_compile_options(rag_embedding_service PRIVATE -Wall -Wextra -Wpedantic)
endif()

# Consumers can use this helper to place the ONNX Runtime DLL beside their EXE.
function(rag_copy_embedding_runtime target_name)
    if(NOT TARGET ${target_name})
        message(FATAL_ERROR "Unknown target passed to rag_copy_embedding_runtime: ${target_name}")
    endif()

    get_target_property(RAG_ONNXRUNTIME_RUNTIME_DLL
        rag_onnxruntime IMPORTED_LOCATION
    )
    if(NOT RAG_ONNXRUNTIME_RUNTIME_DLL OR
       NOT EXISTS "${RAG_ONNXRUNTIME_RUNTIME_DLL}")
        message(FATAL_ERROR
            "The ONNX Runtime DLL target location is unavailable."
        )
    endif()

    add_custom_command(TARGET ${target_name} POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "${RAG_ONNXRUNTIME_RUNTIME_DLL}"
            "$<TARGET_FILE_DIR:${target_name}>"
        VERBATIM
    )
endfunction()
