import { describe, expect, it, vi } from "vitest";

const pgState = vi.hoisted(() => ({
  poolQueries: [] as string[],
  clientQueries: [] as string[],
  ended: 0,
  released: 0,
  queryReject: null as Error | null,
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
    on(_event: string, _listener: unknown): void {}
    async query(text: string): Promise<{ rows: unknown[]; rowCount: number }> {
      if (pgState.queryReject !== null) {
        throw pgState.queryReject;
      }
      pgState.poolQueries.push(text);
      return { rows: [{ value: "pool" }], rowCount: 1 };
    }
    async connect(): Promise<FakeClient> { return new FakeClient(); }
    async end(): Promise<void> { pgState.ended += 1; }
  }
  return { Pool: FakePool };
});

import { PostgresStorageAdapter, normalizePostgresSql } from "../../src/storage/StorageAdapter";
import { TokenSupportStore } from "../../src/storage/TokenSupportStore";
import { CooldownStore } from "../../src/storage/CooldownStore";

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

    // Verify migration version 6 was recorded
    expect(pgState.poolQueries.some((query) => query.includes("sdk_schema_migrations") && query.includes("VALUES($1,$2)"))).toBe(true);

    await storage.close();
    await storage.close();
    expect(pgState.ended).toBe(1);
    expect(pgState.released).toBe(1);
  });

  it("normalizes TokenSupportStore and CooldownStore upserts with multi-column conflict targets", () => {
    // 1. TokenSupportStore upsert
    const tokenSupportSql = normalizePostgresSql(
      "INSERT OR REPLACE INTO sdk_token_support (token, provider, supported, updated_at) VALUES (?, ?, ?, ?)",
    ).text;
    expect(tokenSupportSql).toContain("INSERT INTO sdk_token_support");
    expect(tokenSupportSql).toContain("ON CONFLICT (token,provider) DO UPDATE SET");
    expect(tokenSupportSql).toContain("VALUES ($1, $2, $3, $4)");
    expect(tokenSupportSql).toContain("supported=EXCLUDED.supported");

    // 2. CooldownStore upsert
    const cooldownSql = normalizePostgresSql(
      "INSERT OR REPLACE INTO sdk_cooldown_states (resource_key, category, env_key_name, failure_count, current_cooldown_ms, cooldown_until, first_failure_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).text;
    expect(cooldownSql).toContain("INSERT INTO sdk_cooldown_states");
    expect(cooldownSql).toContain("ON CONFLICT (resource_key) DO UPDATE SET");
    expect(cooldownSql).toContain("VALUES ($1, $2, $3, $4, $5, $6, $7, $8)");
  });

  it("integrates TokenSupportStore and CooldownStore with PostgresStorageAdapter", async () => {
    const storage = new PostgresStorageAdapter("postgresql://user:pass@localhost:5432/evm");
    await storage.initialize();

    const tokenStore = new TokenSupportStore(storage);
    tokenStore.set("USDT", "binance", true);

    const cooldownStore = new CooldownStore(storage);
    cooldownStore.save({
      resourceKey: "etherscan-key-1",
      category: "data-api",
      state: {
        consecutiveFailures: 2,
        currentCooldownMs: 300_000,
        cooldownUntil: 1700000000000,
        firstFailureAt: 1699999700000,
      },
    });

    // Check queries sent to pool
    expect(pgState.poolQueries.some((q) => q.includes("INSERT INTO sdk_token_support") && q.includes("ON CONFLICT (token,provider)"))).toBe(true);
    expect(pgState.poolQueries.some((q) => q.includes("INSERT INTO sdk_cooldown_states") && q.includes("ON CONFLICT (resource_key)"))).toBe(true);
    await storage.close();
  });

  it("redacts sensitive connection URLs in initialization failure messages", async () => {
    const storage = new PostgresStorageAdapter("postgresql://secretuser:supersecretpass@db.example.com:5432/production");
    pgState.queryReject = new Error("FATAL: password authentication failed for user 'secretuser'");
    try {
      await expect(storage.initialize()).rejects.toThrowError(/postgresql:\/\/(?:%5BREDACTED%5D|\[REDACTED\]):(?:%5BREDACTED%5D|\[REDACTED\])@db\.example\.com:5432\/production/);
    } finally {
      pgState.queryReject = null;
    }
  });
});

