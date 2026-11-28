# Electron RAG Server

TypeScript RAG pipeline scaffold with an embedded LanceDB vector store.

## LanceDB

The server uses the official `@lancedb/lancedb` TypeScript SDK in embedded
mode. By default, the local database is stored at `./data/lancedb`. Set
`LANCEDB_URI` to override that location.

The database connection is opened lazily by the VDB manager and reused.
No external vector database server is required for local filesystem storage.

See `vdb-manager/README.md` for the current course-operation contracts and
implementation status.
