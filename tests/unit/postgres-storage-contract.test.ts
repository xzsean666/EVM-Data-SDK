import { describe, expect, it, vi } from "vitest";

const pgState = vi.hoisted(() => ({
  poolQueries: [] as string[],
  clientQueries: [] as string[],
  ended: 0,
  released: 0,
}));

vi.mock("pg", () => {
  class FakeClient {
    async query(text: string): Promise<{ rows: unknown[]; rowCount: number }> {
      pgState.clientQueries.push(text);
      return { rows: [{ value: "client" }], rowCount: 1 };
    }
    release(): void { pgState.released += 1; }
  }
  class FakePool {
    constructor(_options: unknown) {}
    async query(text: string): Promise<{ rows: unknown[]; rowCount: number }> {
      pgState.poolQueries.push(text);
      return { rows: [{ value: "pool" }], rowCount: 1 };
    }
    async connect(): Promise<FakeClient> { return new FakeClient(); }
    async end(): Promise<void> { pgState.ended += 1; }
  }
  return { Pool: FakePool };
});

import { PostgresStorageAdapter } from "../../src/storage/StorageAdapter";

describe("PostgreSQL storage contract", () => {
  it("initializes idempotently, routes service calls through the transaction client, and closes", async () => {
    const storage = new PostgresStorageAdapter("postgresql://localhost/evm");
    await storage.initialize();
    await storage.initialize();
    expect((await storage.get<{ value: string }>("SELECT ? AS value", ["pool"]))?.value).toBe("pool");
    await storage.transaction(async () => {
      expect((await storage.get<{ value: string }>("SELECT ? AS value", ["client"]))?.value).toBe("client");
      await storage.run("INSERT OR IGNORE INTO sdk_price_points(scope_key,timestamp,payload) VALUES(?,?,?)", ["scope", "time", "{}"]).then((result) => expect(result.changes).toBe(1));
    });
    expect(pgState.clientQueries).toContain("BEGIN");
    expect(pgState.clientQueries.some((query) => query.includes("INSERT INTO sdk_price_points") && query.includes("ON CONFLICT DO NOTHING"))).toBe(true);
    await storage.close();
    await storage.close();
    expect(pgState.ended).toBe(1);
    expect(pgState.released).toBe(1);
  });
});
