import * as lancedb from "@lancedb/lancedb";

/** Resolved connection type exposed by the official LanceDB TypeScript SDK. */
export type LanceDbConnection = Awaited<ReturnType<typeof lancedb.connect>>;

/**
 * Owns the application's embedded LanceDB connection.
 *
 * One long-lived connection is shared by VDB operations. The URI defaults to
 * a local directory and can be overridden with LANCEDB_URI. No network
 * database service is required for a filesystem URI.
 */
export class LanceDbClient {
  private connectionPromise?: Promise<LanceDbConnection>;

  public constructor(
    private readonly databaseUri: string =
      process.env.LANCEDB_URI ?? "./data/lancedb",
  ) {
    if (databaseUri.trim().length === 0) {
      throw new Error("LanceDB database URI cannot be empty.");
    }
  }

  /** Opens the database once and reuses the connection for later calls. */
  public connect(): Promise<LanceDbConnection> {
    if (!this.connectionPromise) {
      const pendingConnection = lancedb.connect(this.databaseUri);
      this.connectionPromise = pendingConnection;

      void pendingConnection.catch(() => {
        if (this.connectionPromise === pendingConnection) {
          this.connectionPromise = undefined;
        }
      });
    }

    return this.connectionPromise;
  }

  /** Closes the shared connection and permits a later reconnect. */
  public async close(): Promise<void> {
    const pendingConnection = this.connectionPromise;
    if (!pendingConnection) {
      return;
    }

    const connection = await pendingConnection;
    connection.close();

    if (this.connectionPromise === pendingConnection) {
      this.connectionPromise = undefined;
    }
  }
}
