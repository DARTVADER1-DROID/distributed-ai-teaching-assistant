add_executable(rag_pipeline_test
    main.cpp
)

target_link_libraries(rag_pipeline_test
    PRIVATE
        rag_validator
        rag_extractor
        rag_chunker
)
