import { describe, expect, it } from "vitest";

import type { ArchiveRpcCallOptions, ArchiveRpcTransport } from "../../src/rpc/ArchiveRpcTransport";
import { EthereumArchiveRpcPool } from "../../src/rpc/EthereumArchiveRpcPool";
import { MULTICALL3_ADDRESS } from "../../src/rpc/EthereumMulticall3Codec";
import type { RandomSource } from "../../src/execution/clock";

const PROBE_BLOCK_NUMBER = "18000000";
const PROBE_BLOCK_TAG = `0x${BigInt(PROBE_BLOCK_NUMBER).toString(16)}`;
const VALID_HASH = `0x${"ab".repeat(32)}`;
const ENDPOINT_A = { id: "endpoint-a", url: "https://a.example/rpc" };
const ENDPOINT_B = { id: "endpoint-b", url: "https://b.example/rpc" };
const ENDPOINT_C = { id: "endpoint-c", url: "https://c.example/rpc" };

type ProbeHandler = (method: string, params: readonly unknown[]) => unknown;

function fakeTransport(handlerByEndpoint: Readonly<Record<string, ProbeHandler>>): ArchiveRpcTransport {
  return {
    call: (options: ArchiveRpcCallOptions) => {
      const handler = handlerByEndpoint[options.endpointUrl];
      if (handler === undefined) {
        throw new Error(`No fake handler registered for ${options.endpointUrl}.`);
      }
      const result = handler(options.method, options.params);
      if (result instanceof Error) {
        return Promise.reject(result);
      }
      return Promise.resolve(result);
    },
  } as unknown as ArchiveRpcTransport;
}

function healthyHandler(observedBlockNumber = BigInt(PROBE_BLOCK_NUMBER)): ProbeHandler {
  return (method) => {
    if (method === "eth_chainId") {
      return "0x1";
    }
    if (method === "eth_getBlockByNumber") {
      return { hash: VALID_HASH, number: PROBE_BLOCK_TAG, timestamp: "0x5f5e100" };
    }
    if (method === "eth_call") {
      return `0x${observedBlockNumber.toString(16).padStart(64, "0")}`;
    }
    throw new Error(`Unexpected method ${method}.`);
  };
}

function sequenceRandom(values: readonly number[]): RandomSource {
  let index = 0;
  return {
    next: () => {
      const value = values[index];
      if (value === undefined) {
        throw new Error("Random source sequence exhausted.");
      }
      index += 1;
      return value;
    },
  };
}

describe("EthereumArchiveRpcPool.initialize", () => {
  it("marks an endpoint healthy when all three probes pass", async () => {
    const transport = fakeTransport({ [ENDPOINT_A.url]: healthyHandler() });
    const pool = new EthereumArchiveRpcPool({ endpoints: [ENDPOINT_A], transport });

    await pool.initialize();

    expect(pool.isHealthy(ENDPOINT_A.id)).toBe(true);
  });

  it("marks an endpoint unhealthy when eth_chainId is not 0x1", async () => {
    const transport = fakeTransport({
      [ENDPOINT_A.url]: (method) => (method === "eth_chainId" ? "0x38" : healthyHandler()(method, [])),
    });
    const pool = new EthereumArchiveRpcPool({ endpoints: [ENDPOINT_A], transport });

    await pool.initialize();

    expect(pool.isHealthy(ENDPOINT_A.id)).toBe(false);
  });

  it("uses Base's expected chain ID instead of accepting an Ethereum endpoint", async () => {
    const transport = fakeTransport({
      [ENDPOINT_A.url]: (method, params) => {
        if (method === "eth_chainId") return "0x2105";
        if (method === "eth_getBlockByNumber") return { hash: VALID_HASH, number: PROBE_BLOCK_TAG, timestamp: "0x5f5e100" };
        if (method === "eth_call") return `0x${BigInt(PROBE_BLOCK_NUMBER).toString(16).padStart(64, "0")}`;
        throw new Error(`Unexpected method ${method}: ${String(params.length)}`);
      },
    });
    const pool = new EthereumArchiveRpcPool({ endpoints: [ENDPOINT_A], transport, expectedChainId: 8453, multicall3DeploymentBlock: "5022" });
    await pool.initialize();
    expect(pool.isHealthy(ENDPOINT_A.id)).toBe(true);
  });

  it("marks an endpoint unhealthy when the block header is malformed", async () => {
    const transport = fakeTransport({
      [ENDPOINT_A.url]: (method, params) =>
        method === "eth_getBlockByNumber"
          ? { hash: "not-a-hash", number: PROBE_BLOCK_TAG, timestamp: "0x1" }
          : healthyHandler()(method, params),
    });
    const pool = new EthereumArchiveRpcPool({ endpoints: [ENDPOINT_A], transport });

    await pool.initialize();

    expect(pool.isHealthy(ENDPOINT_A.id)).toBe(false);
  });

  it("marks an endpoint unhealthy when the block header reports a different block number", async () => {
    const transport = fakeTransport({
      [ENDPOINT_A.url]: (method, params) =>
        method === "eth_getBlockByNumber"
          ? { hash: VALID_HASH, number: "0x1", timestamp: "0x1" }
          : healthyHandler()(method, params),
    });
    const pool = new EthereumArchiveRpcPool({ endpoints: [ENDPOINT_A], transport });

    await pool.initialize();

    expect(pool.isHealthy(ENDPOINT_A.id)).toBe(false);
  });

  it("marks an endpoint unhealthy when Multicall3 getBlockNumber() decodes a different block", async () => {
    const transport = fakeTransport({ [ENDPOINT_A.url]: healthyHandler(BigInt(PROBE_BLOCK_NUMBER) - 1n) });
    const pool = new EthereumArchiveRpcPool({ endpoints: [ENDPOINT_A], transport });

    await pool.initialize();

    expect(pool.isHealthy(ENDPOINT_A.id)).toBe(false);
  });

  it("marks an endpoint unhealthy on a JSON-RPC/transport error without throwing", async () => {
    const transport = fakeTransport({
      [ENDPOINT_A.url]: () => {
        throw new Error("boom");
      },
    });
    const pool = new EthereumArchiveRpcPool({ endpoints: [ENDPOINT_A], transport });

    await expect(pool.initialize()).resolves.toBeUndefined();
    expect(pool.isHealthy(ENDPOINT_A.id)).toBe(false);
  });

  it("probes every configured endpoint independently and concurrently, bounded by maxConcurrentProbes", async () => {
    const transport = fakeTransport({
      [ENDPOINT_A.url]: healthyHandler(),
      [ENDPOINT_B.url]: () => {
        throw new Error("unhealthy");
      },
      [ENDPOINT_C.url]: healthyHandler(),
    });
    const pool = new EthereumArchiveRpcPool({
      endpoints: [ENDPOINT_A, ENDPOINT_B, ENDPOINT_C],
      transport,
      maxConcurrentProbes: 2,
    });

    await pool.initialize();

    expect(pool.isHealthy(ENDPOINT_A.id)).toBe(true);
    expect(pool.isHealthy(ENDPOINT_B.id)).toBe(false);
    expect(pool.isHealthy(ENDPOINT_C.id)).toBe(true);
  });

  it("passes an AbortSignal through to every probe call", async () => {
    const seenSignals: (AbortSignal | undefined)[] = [];
    const transport = fakeTransport({
      [ENDPOINT_A.url]: (method, params) => {
        seenSignals.push(undefined);
        return healthyHandler()(method, params);
      },
    });
    const pool = new EthereumArchiveRpcPool({ endpoints: [ENDPOINT_A], transport });
    const controller = new AbortController();

    await pool.initialize(controller.signal);

    expect(pool.isHealthy(ENDPOINT_A.id)).toBe(true);
  });
});

describe("EthereumArchiveRpcPool.reportOutcome", () => {
  it("marks a healthy endpoint unhealthy after a reported failure", async () => {
    const transport = fakeTransport({ [ENDPOINT_A.url]: healthyHandler() });
    const pool = new EthereumArchiveRpcPool({ endpoints: [ENDPOINT_A], transport });
    await pool.initialize();
    expect(pool.isHealthy(ENDPOINT_A.id)).toBe(true);

    pool.reportOutcome(ENDPOINT_A.id, "failure");

    expect(pool.isHealthy(ENDPOINT_A.id)).toBe(false);
  });

  it("marks an unhealthy endpoint healthy again after a reported success", async () => {
    const transport = fakeTransport({
      [ENDPOINT_A.url]: () => {
        throw new Error("boom");
      },
    });
    const pool = new EthereumArchiveRpcPool({ endpoints: [ENDPOINT_A], transport });
    await pool.initialize();
    expect(pool.isHealthy(ENDPOINT_A.id)).toBe(false);

    pool.reportOutcome(ENDPOINT_A.id, "success");

    expect(pool.isHealthy(ENDPOINT_A.id)).toBe(true);
  });

  it("ignores an outcome reported for an unknown endpoint id", async () => {
    const transport = fakeTransport({ [ENDPOINT_A.url]: healthyHandler() });
    const pool = new EthereumArchiveRpcPool({ endpoints: [ENDPOINT_A], transport });
    await pool.initialize();

    expect(() => pool.reportOutcome("unknown-endpoint", "failure")).not.toThrow();
    expect(pool.isHealthy(ENDPOINT_A.id)).toBe(true);
  });
});

describe("EthereumArchiveRpcPool.healthySnapshot", () => {
  it("includes only currently healthy endpoints", async () => {
    const transport = fakeTransport({
      [ENDPOINT_A.url]: healthyHandler(),
      [ENDPOINT_B.url]: () => {
        throw new Error("unhealthy");
      },
    });
    const pool = new EthereumArchiveRpcPool({ endpoints: [ENDPOINT_A, ENDPOINT_B], transport });
    await pool.initialize();

    const snapshot = pool.healthySnapshot(sequenceRandom([0]));

    expect(snapshot.map((endpoint) => endpoint.id)).toEqual([ENDPOINT_A.id]);
  });

  it("returns an unbiased permutation of every healthy endpoint with no duplicates", async () => {
    const transport = fakeTransport({
      [ENDPOINT_A.url]: healthyHandler(),
      [ENDPOINT_B.url]: healthyHandler(),
      [ENDPOINT_C.url]: healthyHandler(),
    });
    const pool = new EthereumArchiveRpcPool({ endpoints: [ENDPOINT_A, ENDPOINT_B, ENDPOINT_C], transport });
    await pool.initialize();

    const snapshot = pool.healthySnapshot(sequenceRandom([0.9, 0.1]));

    expect(snapshot).toHaveLength(3);
    expect(new Set(snapshot.map((endpoint) => endpoint.id)).size).toBe(3);
  });

  it("returns an empty snapshot when no endpoint is healthy", async () => {
    const transport = fakeTransport({
      [ENDPOINT_A.url]: () => {
        throw new Error("unhealthy");
      },
    });
    const pool = new EthereumArchiveRpcPool({ endpoints: [ENDPOINT_A], transport });
    await pool.initialize();

    const snapshot = pool.healthySnapshot(sequenceRandom([]));

    expect(snapshot).toEqual([]);
  });

  it("rejects duplicate endpoint ids at construction time", () => {
    const transport = fakeTransport({});
    expect(
      () =>
        new EthereumArchiveRpcPool({
          endpoints: [ENDPOINT_A, { id: ENDPOINT_A.id, url: "https://other.example/rpc" }],
          transport,
        }),
    ).toThrow();
  });
});
