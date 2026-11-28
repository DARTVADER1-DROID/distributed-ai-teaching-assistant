# Distributed AI Teaching Assistant

A modular project for building a distributed AI-assisted teaching system. The repository currently contains the **Electron RAG Server**, a local PDF ingestion and semantic retrieval backend.

## Current implementation

The `electron-rag-server/` package provides:

- PDF parsing and font/layout-aware validation.
- Hierarchical extraction into Document, Heading and Paragraph nodes.
- Tokenizer-bounded chunking with heading-path context.
- Local BGE-M3 ONNX embeddings (1024 dimensions).
- LanceDB persistence for course metadata and active chunk generations.
- Course create, retrieve, update, delete and list operations.
- Semantic retrieval with optional course-level filtering.
- Express HTTP API, OpenAPI JSON and Swagger UI.
- Windows setup and launch scripts.

## Start here

Read the [Electron RAG Server README](./electron-rag-server/README.md) for runtime requirements, model setup, installation and launch instructions.

## Documentation

| Document | Description |
| --- | --- |
| [Server README](./electron-rag-server/README.md) | Installation, configuration, launch and API entry points. |
| [Architecture](./electron-rag-server/docs/ARCHITECTURE.md) | Components, boundaries, data flow and runtime constraints. |
| [Ingestion and retrieval pipeline](./electron-rag-server/docs/PIPELINE.md) | Step-by-step PDF processing, chunking, embedding and search. |
| [HTTP API reference](./electron-rag-server/docs/API.md) | Routes, request formats, responses and status codes. |
| [Storage and data model](./electron-rag-server/docs/DATA-MODEL.md) | LanceDB tables, fields, generations and consistency behavior. |
| [PDF validator guide](./electron-rag-server/VALIDATOR-GUIDE.md) | Exact font, heading hierarchy and closure rules for input PDFs. |
| [Development and testing](./electron-rag-server/docs/DEVELOPMENT.md) | Install, build, test and local development workflow. |
| [Troubleshooting](./electron-rag-server/docs/TROUBLESHOOTING.md) | Common setup, model, PDF and database failures. |
| [VDB Manager](./electron-rag-server/vdb-manager/README.md) | Course lifecycle and vector database behavior. |
| [Local BGE-M3 models](./electron-rag-server/models/README.md) | Pinned model files, download and verification. |

## Repository status and scope

Documentation describes the implementation currently present in the repository. It does not imply that future teaching-assistant features, answer generation, authentication, a graphical client, or distributed deployment are implemented by this package.

For current API behavior, the running service's Swagger UI at `/docs` and OpenAPI JSON at `/openapi.json` are the executable API references.
