import { describe, expect, it, vi } from "vitest";

import { archiveRpcUnavailable } from "../../src/domain/errors";
import type { ArchiveRpcCallOptions, ArchiveRpcTransport } from "../../src/rpc/ArchiveRpcTransport";
import { EthereumArchiveRpcExecutor } from "../../src/rpc/EthereumArchiveRpcExecutor";
import type { EthereumArchiveRpcEndpoint, EthereumArchiveRpcPool } from "../../src/rpc/EthereumArchiveRpcPool";
import type { RandomSource } from "../../src/execution/clock";

const BLOCK_NUMBER = "18000000";
const BLOCK_TAG = `0x${BigInt(BLOCK_NUMBER).toString(16)}`;
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";
const HASH_A = `0x${"aa".repeat(32)}`;
const HASH_A_REORGED = `0x${"bb".repeat(32)}`;

const ENDPOINT_A: EthereumArchiveRpcEndpoint = { id: "endpoint-a", url: "https://a.example/rpc" };
const ENDPOINT_B: EthereumArchiveRpcEndpoint = { id: "endpoint-b", url: "https://b.example/rpc" };
const ENDPOINT_C: EthereumArchiveRpcEndpoint = { id: "endpoint-c", url: "https://c.example/rpc" };

const NO_RANDOM: RandomSource = {
  next: () => {
    throw new Error("healthySnapshot is faked in these tests and must not consume randomness.");
  },
};

type MethodHandler = (method: string, params: readonly unknown[]) => unknown;

function fakeTransport(handlers: Readonly<Record<string, MethodHandler>>): ArchiveRpcTransport {
  return {
    call: (options: ArchiveRpcCallOptions) => {
      const handler = handlers[options.endpointUrl];
      if (handler === undefined) {
        return Promise.reject(new Error(`No fake handler registered for ${options.endpointUrl}.`));
      }
      let result: unknown;
      try {
        result = handler(options.method, options.params);
      } catch (error: unknown) {
        return Promise.reject(error);
      }
      return Promise.resolve(result);
    },
  } as unknown as ArchiveRpcTransport;
}

function healthyHandler(hash: string, returnDataByBatch: (callData: string) => string): MethodHandler {
  return (method, params) => {
    if (method === "eth_getBlockByNumber") {
      return { hash, number: BLOCK_TAG, timestamp: "0x5f5e100" };
    }
    if (method === "eth_call") {
      const call = params[0] as { to: string; data: string };
      return returnDataByBatch(call.data);
    }
    throw new Error(`Unexpected method ${method}.`);
  };
}

function reorgHandler(firstHash: string, secondHash: string, returnData: string): MethodHandler {
  let blockCalls = 0;
  return (method) => {
    if (method === "eth_getBlockByNumber") {
      blockCalls += 1;
      return { hash: blockCalls === 1 ? firstHash : secondHash, number: BLOCK_TAG, timestamp: "0x1" };
    }
    if (method === "eth_call") {
      return returnData;
    }
    throw new Error(`Unexpected method ${method}.`);
  };
}

interface FakePool extends EthereumArchiveRpcPool {
  readonly outcomes: { readonly id: string; readonly outcome: "success" | "failure" }[];
}

function fakePool(snapshot: readonly EthereumArchiveRpcEndpoint[]): FakePool {
  const outcomes: { readonly id: string; readonly outcome: "success" | "failure" }[] = [];
  return {
    healthySnapshot: () => snapshot,
    reportOutcome: (id: string, outcome: "success" | "failure") => {
      outcomes.push({ id, outcome });
    },
    outcomes,
  } as unknown as FakePool;
}

describe("EthereumArchiveRpcExecutor.executeMulticallBatches", () => {
  it("reads a native balance at an exact block and verifies the block hash", async () => {
    const transport = fakeTransport({
      [ENDPOINT_A.url]: (method) => {
        if (method === "eth_getBlockByNumber") {
          return { hash: HASH_A, number: BLOCK_TAG, timestamp: "0x5f5e100" };
        }
        if (method === "eth_getBalance") return "0x1aff740c7e76";
        throw new Error(`Unexpected method ${method}.`);
      },
    });
    const pool = fakePool([ENDPOINT_A]);
    const executor = new EthereumArchiveRpcExecutor({ pool, randomSource: NO_RANDOM, transport });

    await expect(executor.getNativeBalanceAtBlock({
      address: "0x1111111111111111111111111111111111111111",
      blockNumber: BLOCK_NUMBER,
    })).resolves.toEqual({
      amount: BigInt("0x1aff740c7e76").toString(10),
      blockHash: HASH_A,
      blockTimestamp: "100000000",
      rpcEndpointId: ENDPOINT_A.id,
    });
    expect(pool.outcomes).toEqual([{ id: ENDPOINT_A.id, outcome: "success" }]);
  });

  it("races a bounded endpoint wave when explicitly configured", async () => {
    const calls: string[] = [];
    const transport: ArchiveRpcTransport = {
      call: (options: ArchiveRpcCallOptions) => {
        calls.push(options.endpointUrl);
        if (options.endpointUrl === ENDPOINT_A.url) {
          return new Promise((_, reject) => {
            options.signal?.addEventListener("abort", () => reject(archiveRpcUnavailable("cancelled")), { once: true });
          });
        }
        return Promise.resolve({ number: "0x123", timestamp: "0x1" });
      },
    } as unknown as ArchiveRpcTransport;
    const pool = fakePool([ENDPOINT_A, ENDPOINT_B]);
    const executor = new EthereumArchiveRpcExecutor({
      pool,
      randomSource: NO_RANDOM,
      transport,
      maxConcurrentRpcAttempts: 2,
    });

    const result = await executor.findLatestBlockNumber();

    expect(result).toEqual({ blockNumber: "291", rpcEndpointId: ENDPOINT_B.id });
    expect(calls).toEqual([ENDPOINT_A.url, ENDPOINT_B.url]);
    expect(pool.outcomes).toEqual([{ id: ENDPOINT_B.id, outcome: "success" }]);
  });

  it("pins the whole operation to one endpoint and returns batches in order", async () => {
    const returnDataA = "0x" + "01".repeat(32);
    const returnDataB = "0x" + "02".repeat(32);
    const transport = fakeTransport({
      [ENDPOINT_A.url]: healthyHandler(HASH_A, (callData) => (callData.endsWith("aa") ? returnDataA : returnDataB)),
    });
    const pool = fakePool([ENDPOINT_A]);
    const executor = new EthereumArchiveRpcExecutor({ pool, randomSource: NO_RANDOM, transport });

    const result = await executor.executeMulticallBatches({
      blockNumber: BLOCK_NUMBER,
      multicall3Address: MULTICALL3_ADDRESS,
      batches: ["0xaa", "0xbb"],
    });

    expect(result.rpcEndpointId).toBe(ENDPOINT_A.id);
    expect(result.blockHash).toBe(HASH_A);
    expect(result.batchReturnData).toEqual([returnDataA, returnDataB]);
    expect(pool.outcomes).toEqual([{ id: ENDPOINT_A.id, outcome: "success" }]);
  });

  it("restarts on the next endpoint after a retryable failure, discarding partial results", async () => {
    let endpointACalls = 0;
    const transport = fakeTransport({
      [ENDPOINT_A.url]: (method) => {
        endpointACalls += 1;
        if (method === "eth_getBlockByNumber") {
          return { hash: HASH_A, number: BLOCK_TAG, timestamp: "0x1" };
        }
        // Fails on the first batch call, after the pre-header read succeeded.
        throw archiveRpcUnavailable("network blip");
      },
      [ENDPOINT_B.url]: healthyHandler(HASH_A, () => "0x03"),
    });
    const pool = fakePool([ENDPOINT_A, ENDPOINT_B]);
    const executor = new EthereumArchiveRpcExecutor({ pool, randomSource: NO_RANDOM, transport });

    const result = await executor.executeMulticallBatches({
      blockNumber: BLOCK_NUMBER,
      multicall3Address: MULTICALL3_ADDRESS,
      batches: ["0xaa"],
    });

    expect(result.rpcEndpointId).toBe(ENDPOINT_B.id);
    expect(result.batchReturnData).toEqual(["0x03"]);
    expect(endpointACalls).toBe(2); // pre-header read, then the failing batch call.
    expect(pool.outcomes).toEqual([
      { id: ENDPOINT_A.id, outcome: "failure" },
      { id: ENDPOINT_B.id, outcome: "success" },
    ]);
  });

  it("stops immediately on a non-retryable failure without trying the next endpoint", async () => {
    const transport = fakeTransport({
      [ENDPOINT_A.url]: (method) => {
        if (method === "eth_getBlockByNumber") {
          // Malformed hash triggers a non-retryable RPC_RESPONSE_INVALID.
          return { hash: "not-a-hash", number: BLOCK_TAG, timestamp: "0x1" };
        }
        throw new Error("unreachable");
      },
    });
    const pool = fakePool([ENDPOINT_A, ENDPOINT_B]);
    const executor = new EthereumArchiveRpcExecutor({ pool, randomSource: NO_RANDOM, transport });

    await expect(
      executor.executeMulticallBatches({
        blockNumber: BLOCK_NUMBER,
        multicall3Address: MULTICALL3_ADDRESS,
        batches: ["0xaa"],
      }),
    ).rejects.toMatchObject({ code: "RPC_RESPONSE_INVALID" });
    expect(pool.outcomes).toEqual([{ id: ENDPOINT_A.id, outcome: "failure" }]);
  });

  it("detects a block hash reorg between pre/post reads and restarts on the next endpoint", async () => {
    const transport = fakeTransport({
      [ENDPOINT_A.url]: reorgHandler(HASH_A, HASH_A_REORGED, "0x01"),
      [ENDPOINT_B.url]: healthyHandler(HASH_A, () => "0x02"),
    });
    const pool = fakePool([ENDPOINT_A, ENDPOINT_B]);
    const executor = new EthereumArchiveRpcExecutor({ pool, randomSource: NO_RANDOM, transport });

    const result = await executor.executeMulticallBatches({
      blockNumber: BLOCK_NUMBER,
      multicall3Address: MULTICALL3_ADDRESS,
      batches: ["0xaa"],
    });

    expect(result.rpcEndpointId).toBe(ENDPOINT_B.id);
    expect(result.blockHash).toBe(HASH_A);
    expect(pool.outcomes).toEqual([
      { id: ENDPOINT_A.id, outcome: "failure" },
      { id: ENDPOINT_B.id, outcome: "success" },
    ]);
  });

  it("bounds attempts by maxRpcAttempts even when more healthy endpoints exist", async () => {
    const attemptedEndpoints: string[] = [];
    const transport = fakeTransport({
      [ENDPOINT_A.url]: () => {
        attemptedEndpoints.push(ENDPOINT_A.id);
        throw archiveRpcUnavailable("always fails");
      },
      [ENDPOINT_B.url]: () => {
        attemptedEndpoints.push(ENDPOINT_B.id);
        throw archiveRpcUnavailable("always fails");
      },
      [ENDPOINT_C.url]: () => {
        attemptedEndpoints.push(ENDPOINT_C.id);
        throw archiveRpcUnavailable("always fails");
      },
    });
    const pool = fakePool([ENDPOINT_A, ENDPOINT_B, ENDPOINT_C]);
    const executor = new EthereumArchiveRpcExecutor({
      pool,
      randomSource: NO_RANDOM,
      transport,
      maxRpcAttempts: 2,
    });

    await expect(
      executor.executeMulticallBatches({
        blockNumber: BLOCK_NUMBER,
        multicall3Address: MULTICALL3_ADDRESS,
        batches: ["0xaa"],
      }),
    ).rejects.toMatchObject({ code: "ARCHIVE_RPC_UNAVAILABLE" });
    expect(attemptedEndpoints).toEqual([ENDPOINT_A.id, ENDPOINT_B.id]);
  });

  it("throws ARCHIVE_RPC_UNAVAILABLE immediately when no healthy endpoint is available", async () => {
    const transport = fakeTransport({});
    const pool = fakePool([]);
    const executor = new EthereumArchiveRpcExecutor({ pool, randomSource: NO_RANDOM, transport });

    await expect(
      executor.executeMulticallBatches({
        blockNumber: BLOCK_NUMBER,
        multicall3Address: MULTICALL3_ADDRESS,
        batches: ["0xaa"],
      }),
    ).rejects.toMatchObject({ code: "ARCHIVE_RPC_UNAVAILABLE" });
  });

  it("stops retrying once the total timeout deadline has passed, without trying every endpoint", async () => {
    let calls = 0;
    const now = () => {
      calls += 1;
      return calls * 50;
    };
    const transport = fakeTransport({
      [ENDPOINT_A.url]: () => {
        throw archiveRpcUnavailable("always fails");
      },
      [ENDPOINT_B.url]: () => {
        throw new Error("must never be called: total timeout should have already elapsed");
      },
    });
    const pool = fakePool([ENDPOINT_A, ENDPOINT_B]);
    const executor = new EthereumArchiveRpcExecutor({
      pool,
      randomSource: NO_RANDOM,
      transport,
      totalTimeoutMs: 100,
      now,
    });

    await expect(
      executor.executeMulticallBatches({
        blockNumber: BLOCK_NUMBER,
        multicall3Address: MULTICALL3_ADDRESS,
        batches: ["0xaa"],
      }),
    ).rejects.toMatchObject({ code: "ARCHIVE_RPC_UNAVAILABLE" });
    expect(pool.outcomes).toEqual([{ id: ENDPOINT_A.id, outcome: "failure" }]);
  });

  it("does not try the next endpoint once the caller's signal is already aborted", async () => {
    const transport = fakeTransport({
      [ENDPOINT_A.url]: () => {
        throw new Error("must never be called: signal is already aborted");
      },
    });
    const pool = fakePool([ENDPOINT_A]);
    const executor = new EthereumArchiveRpcExecutor({ pool, randomSource: NO_RANDOM, transport });
    const controller = new AbortController();
    controller.abort();

    await expect(
      executor.executeMulticallBatches({
        blockNumber: BLOCK_NUMBER,
        multicall3Address: MULTICALL3_ADDRESS,
        batches: ["0xaa"],
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(pool.outcomes).toEqual([]);
  });

  it("stops after a failure if the signal became aborted during that attempt", async () => {
    const controller = new AbortController();
    const transport = fakeTransport({
      [ENDPOINT_A.url]: () => {
        controller.abort();
        throw new Error("network blip during which the caller cancelled");
      },
      [ENDPOINT_B.url]: () => {
        throw new Error("must never be called: caller aborted after endpoint-a's failure");
      },
    });
    const pool = fakePool([ENDPOINT_A, ENDPOINT_B]);
    const executor = new EthereumArchiveRpcExecutor({ pool, randomSource: NO_RANDOM, transport });

    await expect(
      executor.executeMulticallBatches({
        blockNumber: BLOCK_NUMBER,
        multicall3Address: MULTICALL3_ADDRESS,
        batches: ["0xaa"],
        signal: controller.signal,
      }),
    ).rejects.toThrow("network blip during which the caller cancelled");
    expect(pool.outcomes).toEqual([{ id: ENDPOINT_A.id, outcome: "failure" }]);
  });

  it("maps a JSON-RPC node-level error into a retryable failure and restarts on the next endpoint", async () => {
    // Simulates the transport layer having already mapped a node-level
    // JSON-RPC error (or network failure) into a retryable EvmDataError, as
    // `ArchiveRpcTransport.call()` does internally. Confirms an explicit
    // retryable EvmDataError thrown by the transport layer is honored
    // end-to-end, restarting on the next endpoint.
    const transport = fakeTransport({
      [ENDPOINT_A.url]: (method) => {
        if (method === "eth_getBlockByNumber") {
          throw archiveRpcUnavailable("archive state unavailable at this endpoint");
        }
        throw new Error("unreachable");
      },
      [ENDPOINT_B.url]: healthyHandler(HASH_A, () => "0x09"),
    });
    const pool = fakePool([ENDPOINT_A, ENDPOINT_B]);
    const executor = new EthereumArchiveRpcExecutor({ pool, randomSource: NO_RANDOM, transport });

    const result = await executor.executeMulticallBatches({
      blockNumber: BLOCK_NUMBER,
      multicall3Address: MULTICALL3_ADDRESS,
      batches: ["0xaa"],
    });

    expect(result.rpcEndpointId).toBe(ENDPOINT_B.id);
  });

  it("passes the caller's AbortSignal through to the underlying transport calls", async () => {
    const seenSignals: (AbortSignal | undefined)[] = [];
    const transport: ArchiveRpcTransport = {
      call: vi.fn((options: ArchiveRpcCallOptions) => {
        seenSignals.push(options.signal);
        if (options.method === "eth_getBlockByNumber") {
          return Promise.resolve({ hash: HASH_A, number: BLOCK_TAG, timestamp: "0x1" });
        }
        return Promise.resolve("0x01");
      }),
    } as unknown as ArchiveRpcTransport;
    const pool = fakePool([ENDPOINT_A]);
    const executor = new EthereumArchiveRpcExecutor({ pool, randomSource: NO_RANDOM, transport });
    const controller = new AbortController();

    await executor.executeMulticallBatches({
      blockNumber: BLOCK_NUMBER,
      multicall3Address: MULTICALL3_ADDRESS,
      batches: ["0xaa"],
      signal: controller.signal,
    });

    expect(seenSignals.every((signal) => signal === controller.signal)).toBe(true);
  });
});
