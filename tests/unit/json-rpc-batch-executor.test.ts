import { describe, expect, it, vi } from "vitest";

import { JsonRpcBatchExecutor, type RpcEndpoint, type RpcPoolLike } from "../../src/rpc/JsonRpcBatchExecutor";
import { ArchiveRpcTransport, type ArchiveRpcBatchCallOptions, type JsonRpcBatchResponseItem } from "../../src/rpc/ArchiveRpcTransport";
import type { RandomSource } from "../../src/execution/clock";
import { RpcService } from "../../src/rpc/RpcService";

const ENDPOINT_1: RpcEndpoint = { id: "rpc-1", url: "https://rpc1.example/rpc" };
const ENDPOINT_2: RpcEndpoint = { id: "rpc-2", url: "https://rpc2.example/rpc" };
const ENDPOINT_3: RpcEndpoint = { id: "rpc-3", url: "https://rpc3.example/rpc" };

interface FakePoolOptions {
  readonly endpoints?: readonly RpcEndpoint[];
  readonly onReportOutcome?: (id: string, outcome: "success" | "failure") => void;
  readonly onRefreshIfNeeded?: (signal?: AbortSignal) => Promise<void>;
}

function createFakePool(options: FakePoolOptions = {}): RpcPoolLike & {
  readonly reportedOutcomes: { readonly id: string; readonly outcome: "success" | "failure" }[];
  refreshCount: number;
} {
  const reportedOutcomes: { readonly id: string; readonly outcome: "success" | "failure" }[] = [];
  let refreshCount = 0;
  const currentEndpoints = [...(options.endpoints ?? [ENDPOINT_1, ENDPOINT_2, ENDPOINT_3])];

  return {
    reportedOutcomes,
    get refreshCount() {
      return refreshCount;
    },
    healthySnapshot: (randomSource: RandomSource) => {
      // Simulate random permutation using randomSource
      const copy = [...currentEndpoints];
      for (let i = copy.length - 1; i > 0; i -= 1) {
        const j = Math.floor(randomSource.next() * (i + 1));
        const tmp = copy[i]!;
        copy[i] = copy[j]!;
        copy[j] = tmp;
      }
      return copy;
    },
    reportOutcome: (id: string, outcome: "success" | "failure") => {
      reportedOutcomes.push({ id, outcome });
      options.onReportOutcome?.(id, outcome);
    },
    refreshIfNeeded: async (signal?: AbortSignal) => {
      refreshCount += 1;
      await options.onRefreshIfNeeded?.(signal);
    },
  };
}

function fakeBatchTransport(
  handler: (options: ArchiveRpcBatchCallOptions) => readonly JsonRpcBatchResponseItem[] | Promise<readonly JsonRpcBatchResponseItem[]>,
): ArchiveRpcTransport {
  return {
    batchCall: vi.fn((options: ArchiveRpcBatchCallOptions) => Promise.resolve(handler(options))),
    call: vi.fn(),
  } as unknown as ArchiveRpcTransport;
}

describe("JsonRpcBatchExecutor", () => {
  it("returns empty array immediately when requests are empty", async () => {
    const pool = createFakePool();
    const transport = fakeBatchTransport(() => []);
    const executor = new JsonRpcBatchExecutor({ pool, transport });

    const results = await executor.executeBatch([]);
    expect(results).toEqual([]);
    expect(transport.batchCall).not.toHaveBeenCalled();
  });

  it("splits large batch into chunks and merges results preserving order", async () => {
    const pool = createFakePool();
    const callsReceived: ArchiveRpcBatchCallOptions[] = [];
    const transport = fakeBatchTransport((options) => {
      callsReceived.push(options);
      return options.requests.map((r) => ({
        id: r.id,
        success: true,
        result: `res-${r.id}`,
      }));
    });

    const executor = new JsonRpcBatchExecutor({
      pool,
      transport,
      defaultBatchChunkSize: 2,
    });

    const requests = [
      { id: "call-1", method: "eth_getBalance", params: ["0x1"] },
      { id: "call-2", method: "eth_getBalance", params: ["0x2"] },
      { id: "call-3", method: "eth_getBalance", params: ["0x3"] },
      { id: "call-4", method: "eth_getBalance", params: ["0x4"] },
      { id: "call-5", method: "eth_getBalance", params: ["0x5"] },
    ];

    const results = await executor.executeBatch(requests, { batchChunkSize: 2 });

    expect(callsReceived).toHaveLength(3);
    expect(callsReceived[0]?.requests).toHaveLength(2);
    expect(callsReceived[1]?.requests).toHaveLength(2);
    expect(callsReceived[2]?.requests).toHaveLength(1);

    expect(results).toHaveLength(5);
    expect(results[0]).toEqual({ id: "call-1", success: true, result: "res-call-1" });
    expect(results[1]).toEqual({ id: "call-2", success: true, result: "res-call-2" });
    expect(results[2]).toEqual({ id: "call-3", success: true, result: "res-call-3" });
    expect(results[3]).toEqual({ id: "call-4", success: true, result: "res-call-4" });
    expect(results[4]).toEqual({ id: "call-5", success: true, result: "res-call-5" });
  });

  it("handles partial failure in executeBatch", async () => {
    const pool = createFakePool();
    const transport = fakeBatchTransport((options) => {
      return options.requests.map((r, i) => {
        if (r.id === "bad-call") {
          return {
            id: r.id,
            success: false,
            error: { code: 3, message: "execution reverted" },
          };
        }
        return {
          id: r.id,
          success: true,
          result: "0x123",
        };
      });
    });

    const executor = new JsonRpcBatchExecutor({ pool, transport });

    const results = await executor.executeBatch([
      { id: "good-call", method: "eth_call", params: [] },
      { id: "bad-call", method: "eth_call", params: [] },
    ]);

    expect(results[0]).toEqual({ id: "good-call", success: true, result: "0x123" });
    expect(results[1]).toEqual({
      id: "bad-call",
      success: false,
      error: { code: 3, message: "execution reverted" },
    });
  });

  it("executeStrictBatch returns unwrapped results when all succeed", async () => {
    const pool = createFakePool();
    const transport = fakeBatchTransport((options) => {
      return options.requests.map((r) => ({
        id: r.id,
        success: true,
        result: `val-${r.id}`,
      }));
    });

    const executor = new JsonRpcBatchExecutor({ pool, transport });

    const results = await executor.executeStrictBatch<string>([
      { method: "eth_blockNumber" },
      { method: "eth_chainId" },
    ]);

    expect(results).toEqual(["val-1", "val-2"]);
  });

  it("executeStrictBatch throws when an item has failed", async () => {
    const pool = createFakePool();
    const transport = fakeBatchTransport((options) => {
      return options.requests.map((r) => {
        if (r.id === 1) {
          return { id: r.id, success: true, result: "0x1" };
        }
        return { id: r.id, success: false, error: { code: -32000, message: "header not found" } };
      });
    });

    const executor = new JsonRpcBatchExecutor({ pool, transport });

    await expect(
      executor.executeStrictBatch([
        { id: 1, method: "eth_blockNumber" },
        { id: 2, method: "eth_getBlockByNumber" },
      ]),
    ).rejects.toMatchObject({
      code: "RPC_RESPONSE_INVALID",
    });
  });

  it("fails over to next healthy endpoint when transport fails", async () => {
    const pool = createFakePool({ endpoints: [ENDPOINT_1, ENDPOINT_2] });
    const attemptedUrls: string[] = [];

    const transport = fakeBatchTransport((options) => {
      attemptedUrls.push(options.endpointUrl);
      if (options.endpointUrl === ENDPOINT_1.url) {
        throw new Error("Connection refused");
      }
      return options.requests.map((r) => ({ id: r.id, success: true, result: "ok" }));
    });

    // Provide a deterministic randomSource that picks ENDPOINT_1 first
    const mockRandom: RandomSource = { next: () => 0.99 }; // Will preserve [ENDPOINT_1, ENDPOINT_2]
    const executor = new JsonRpcBatchExecutor({
      pool,
      transport,
      randomSource: mockRandom,
    });

    const results = await executor.executeBatch([{ method: "eth_blockNumber" }]);

    expect(results[0]?.result).toBe("ok");
    expect(attemptedUrls).toEqual([ENDPOINT_1.url, ENDPOINT_2.url]);
    expect(pool.reportedOutcomes).toEqual([
      { id: ENDPOINT_1.id, outcome: "failure" },
      { id: ENDPOINT_2.id, outcome: "success" },
    ]);
  });

  it("refreshes pool if empty and retries", async () => {
    let refreshed = false;
    const pool: RpcPoolLike = {
      healthySnapshot: () => (refreshed ? [ENDPOINT_1] : []),
      reportOutcome: vi.fn(),
      refreshIfNeeded: vi.fn(async () => {
        refreshed = true;
      }),
    };

    const transport = fakeBatchTransport((options) => {
      return options.requests.map((r) => ({ id: r.id, success: true, result: "ok" }));
    });

    const executor = new JsonRpcBatchExecutor({ pool, transport });
    const results = await executor.executeBatch([{ method: "eth_blockNumber" }]);

    expect(pool.refreshIfNeeded).toHaveBeenCalledTimes(1);
    expect(results[0]?.result).toBe("ok");
  });

  it("executes single call helper method", async () => {
    const pool = createFakePool();
    const transport = fakeBatchTransport(() => [
      { id: 1, success: true, result: "0x12345" },
    ]);

    const executor = new JsonRpcBatchExecutor({ pool, transport });
    const result = await executor.call<string>({ method: "eth_blockNumber" });

    expect(result).toBe("0x12345");
  });

  describe("RpcService integration", () => {
    it("delegates batch and strictBatch calls to batchExecutor", async () => {
      const pool = createFakePool();
      const transport = fakeBatchTransport((options) => {
        return options.requests.map((r) => ({ id: r.id, success: true, result: `res-${r.id}` }));
      });
      const batchExecutor = new JsonRpcBatchExecutor({ pool, transport });

      const rpcService = new RpcService({
        executor: {
          executeMulticallBatches: vi.fn(),
        },
        batchExecutor,
      });

      const batchResults = await rpcService.batch([{ id: "test", method: "eth_chainId" }]);
      expect(batchResults[0]).toEqual({ id: "test", success: true, result: "res-test" });

      const strictResults = await rpcService.strictBatch<string>([{ id: "test-2", method: "eth_chainId" }]);
      expect(strictResults).toEqual(["res-test-2"]);

      const singleResult = await rpcService.call<string>({ method: "eth_chainId" });
      expect(singleResult).toBe("res-1");
    });
  });
});
