import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SqliteStorageAdapter } from "../../src/storage/StorageAdapter";
import { CooldownStore } from "../../src/storage/CooldownStore";
import { EvmDataClient } from "../../src/client/EvmDataClient";
import type { HttpTransport, HttpResponse } from "../../src/transport/HttpTransport";

class MockHttpTransport implements HttpTransport {
  async request(): Promise<HttpResponse> {
    return {
      status: 200,
      headers: {},
      body: { jsonrpc: "2.0", id: 1, result: "0x1" },
    };
  }
}

describe("Cooldown SQLite Persistence", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "evm-cooldown-test-"));
    dbPath = join(tempDir, "cooldown.db");
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  it("persists and retrieves cooldown records using CooldownStore directly", async () => {
    const storage = new SqliteStorageAdapter(dbPath);
    await storage.initialize();

    const store = new CooldownStore(storage);
    const initialRecords = await store.loadAll();
    expect(initialRecords).toHaveLength(0);

    const now = 1_000_000;
    store.save({
      resourceKey: "rpc:alchemy-ethereum-1",
      category: "rpc",
      envKeyName: "ALCHEMY_API_KEY",
      state: {
        consecutiveFailures: 2,
        currentCooldownMs: 300_000,
        cooldownUntil: now + 300_000,
        firstFailureAt: now - 60_000,
      },
      now,
    });

    store.save({
      resourceKey: "data-api:etherscan-key-1",
      category: "data-api",
      envKeyName: "ETHERSCAN_API_KEY_1",
      state: {
        consecutiveFailures: 1,
        currentCooldownMs: 60_000,
        cooldownUntil: now + 60_000,
        firstFailureAt: now,
      },
      now,
    });

    const records = await store.loadAll();
    expect(records).toHaveLength(2);

    const rpcRecord = records.find((r) => r.resourceKey === "rpc:alchemy-ethereum-1");
    expect(rpcRecord).toBeDefined();
    expect(rpcRecord?.category).toBe("rpc");
    expect(rpcRecord?.envKeyName).toBe("ALCHEMY_API_KEY");
    expect(rpcRecord?.failureCount).toBe(2);
    expect(rpcRecord?.currentCooldownMs).toBe(300_000);
    expect(rpcRecord?.cooldownUntil).toBe(now + 300_000);
    expect(rpcRecord?.firstFailureAt).toBe(now - 60_000);

    const dataApiRecord = records.find((r) => r.resourceKey === "data-api:etherscan-key-1");
    expect(dataApiRecord).toBeDefined();
    expect(dataApiRecord?.category).toBe("data-api");
    expect(dataApiRecord?.envKeyName).toBe("ETHERSCAN_API_KEY_1");

    store.delete("rpc:alchemy-ethereum-1");
    const recordsAfterDelete = await store.loadAll();
    expect(recordsAfterDelete).toHaveLength(1);
    expect(recordsAfterDelete[0]?.resourceKey).toBe("data-api:etherscan-key-1");

    await storage.close();
  });

  it("retains cooldown state across EvmDataClient instances with the same SQLite database", async () => {
    const storageUrl = `sqlite:${dbPath}`;
    const transport = new MockHttpTransport();

    // Instance A: run, fail, and close
    const clientA = new EvmDataClient(
      {
        storage: { url: storageUrl },
        chainlink: {
          enabled: true,
          healthCheckTimeoutMs: 10,
          useBuiltinEthereumArchiveRpcs: false,
          rpcEndpoints: [{ id: "custom-endpoint-1", url: "https://rpc.example.com" }],
        },
        providers: [
          {
            kind: "etherscan",
            apiKeys: ["mock-etherscan-key"],
            envKeyNames: ["ETHERSCAN_API_KEY_1"],
          },
        ],
      },
      { transport },
    );

    await clientA.initialize();

    const poolA = clientA.getArchiveRpcPool()!;
    const credentialPoolsA = clientA.getCredentialPools();
    const etherscanPoolA = credentialPoolsA.get("etherscan-1")!;

    const leaseA = etherscanPoolA.acquire()!;
    expect(leaseA).toBeDefined();

    // Trigger failure on clientA
    const failureTime = 2_000_000;
    poolA.reportOutcome("custom-endpoint-1", "failure", failureTime);
    etherscanPoolA.report(leaseA, "rate_limited", failureTime);

    // Verify clientA is cooling down
    const poolStateA = poolA.getEndpointCooldownState("custom-endpoint-1", failureTime)!;
    expect(poolStateA.isCoolingDown).toBe(true);
    expect(poolStateA.consecutiveFailures).toBe(1);
    expect(poolStateA.currentCooldownMs).toBe(60_000);

    const credStateA = etherscanPoolA.state(leaseA.id, failureTime)!;
    expect(credStateA.failureCount).toBe(1);
    expect(credStateA.isCoolingDown).toBe(true);

    await clientA.close();

    // Instance B: create brand new client pointing to the same SQLite db
    const clientB = new EvmDataClient(
      {
        storage: { url: storageUrl },
        chainlink: {
          enabled: true,
          healthCheckTimeoutMs: 10,
          useBuiltinEthereumArchiveRpcs: false,
          rpcEndpoints: [{ id: "custom-endpoint-1", url: "https://rpc.example.com" }],
        },
        providers: [
          {
            kind: "etherscan",
            apiKeys: ["mock-etherscan-key"],
            envKeyNames: ["ETHERSCAN_API_KEY_1"],
          },
        ],
      },
      { transport },
    );

    // Before initialize: memory state is default (not yet restored)
    expect(clientB.getArchiveRpcPool()!.getEndpointCooldownState("custom-endpoint-1", failureTime)?.consecutiveFailures).toBe(0);

    // Initialize: loads persisted cooldowns from SQLite
    await clientB.initialize();

    const poolB = clientB.getArchiveRpcPool()!;
    const credentialPoolsB = clientB.getCredentialPools();
    const etherscanPoolB = credentialPoolsB.get("etherscan-1")!;

    // Verify clientB has fully restored the cooldown state
    const poolStateB = poolB.getEndpointCooldownState("custom-endpoint-1", failureTime)!;
    expect(poolStateB.isCoolingDown).toBe(true);
    expect(poolStateB.consecutiveFailures).toBe(1);
    expect(poolStateB.currentCooldownMs).toBe(60_000);
    expect(poolStateB.totalCooldownDurationMs).toBe(0);

    const credStateB = etherscanPoolB.state(leaseA.id, failureTime)!;
    expect(credStateB.failureCount).toBe(1);
    expect(credStateB.isCoolingDown).toBe(true);
    expect(credStateB.currentCooldownMs).toBe(60_000);

    // Now fail a second time on clientB: advances to 5m tier (300,000 ms)
    const secondFailureTime = failureTime + 70_000; // after 1m CD expired
    poolB.reportOutcome("custom-endpoint-1", "failure", secondFailureTime);

    const secondPoolStateB = poolB.getEndpointCooldownState("custom-endpoint-1", secondFailureTime)!;
    expect(secondPoolStateB.consecutiveFailures).toBe(2);
    expect(secondPoolStateB.currentCooldownMs).toBe(300_000);
    expect(secondPoolStateB.totalCooldownDurationMs).toBe(70_000); // from first failure

    // Now succeed on clientB: clears cooldown and removes from SQLite
    poolB.reportOutcome("custom-endpoint-1", "success", secondFailureTime + 310_000);
    const recoveredState = poolB.getEndpointCooldownState("custom-endpoint-1", secondFailureTime + 310_000)!;
    expect(recoveredState.consecutiveFailures).toBe(0);
    expect(recoveredState.isCoolingDown).toBe(false);

    const storedRecords = await clientB.cooldownStore.loadAll();
    const endpointRecord = storedRecords.find((r) => r.resourceKey === "rpc:custom-endpoint-1");
    expect(endpointRecord).toBeUndefined();

    await clientB.close();
  });
});
