import { describe, expect, it, vi } from "vitest";

import { RpcService, type ArchiveRpcMulticallExecutor } from "../../src/rpc/RpcService";
import {
  MULTICALL3_ADDRESS,
  MULTICALL3_BASE_MAINNET_DEPLOYMENT_BLOCK,
  MULTICALL3_ETHEREUM_MAINNET_DEPLOYMENT_BLOCK,
  decodeAggregate3Result,
} from "../../src/rpc/EthereumMulticall3Codec";

const TARGET_A = "0x1111111111111111111111111111111111111111";
const TARGET_B = "0x2222222222222222222222222222222222222222";
const BLOCK_HASH = `0x${"ab".repeat(32)}`;

function wordUint(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function encodeAggregate3Result(tuples: readonly { success: boolean; data: string }[]): string {
  const dataHexes = tuples.map((tuple) => tuple.data.replace(/^0x/, ""));
  let offset = BigInt(tuples.length * 32);
  const offsets: string[] = [];
  const bodies: string[] = [];
  tuples.forEach((tuple, index) => {
    offsets.push(wordUint(offset));
    const dataHex = dataHexes[index]!;
    const padded = dataHex.padEnd(Math.ceil(dataHex.length / 64) * 64, "0");
    const body = `${wordUint(tuple.success ? 1n : 0n)}${wordUint(64n)}${wordUint(BigInt(dataHex.length / 2))}${padded}`;
    bodies.push(body);
    offset += BigInt(body.length / 2);
  });
  return `0x${wordUint(32n)}${wordUint(BigInt(tuples.length))}${offsets.join("")}${bodies.join("")}`;
}

const BLOCK_TIMESTAMP = "1690000000";

function fakeExecutor(
  batchReturnData: readonly string[],
  rpcEndpointId = "fake-endpoint",
): ArchiveRpcMulticallExecutor & { readonly executeMulticallBatches: ReturnType<typeof vi.fn> } {
  return {
    executeMulticallBatches: vi.fn().mockResolvedValue({
      blockHash: BLOCK_HASH,
      blockTimestamp: BLOCK_TIMESTAMP,
      rpcEndpointId,
      batchReturnData,
    }),
  };
}

describe("RpcService.multicallAtBlock", () => {
  it("validates, batches, and decodes calls in input order using an injected executor", async () => {
    const encoded = encodeAggregate3Result([
      { success: true, data: "0x0000000000000000000000000000000000000000000000000000000000000005" },
      { success: false, data: "0x08c379a0" },
    ]);
    const executor = fakeExecutor([encoded]);
    const service = new RpcService({ executor, maxCallsPerMulticall: 100 });

    const result = await service.multicallAtBlock({
      chain: 1,
      blockNumber: "18000000",
      calls: [
        { id: "call-a", target: TARGET_A, callData: "0xfeaf968c" },
        { id: "call-b", target: TARGET_B, callData: "0x313ce567", allowFailure: true },
      ],
    });

    expect(result.chainId).toBe(1);
    expect(result.blockNumber).toBe("18000000");
    expect(result.blockHash).toBe(BLOCK_HASH);
    expect(result.blockTimestamp).toBe(BLOCK_TIMESTAMP);
    expect(result.rpcEndpointId).toBe("fake-endpoint");
    expect(result.results).toEqual([
      {
        id: "call-a",
        success: true,
        returnData: "0x0000000000000000000000000000000000000000000000000000000000000005",
      },
      { id: "call-b", success: false, returnData: "0x08c379a0" },
    ]);

    expect(executor.executeMulticallBatches).toHaveBeenCalledTimes(1);
    const callArgs = executor.executeMulticallBatches.mock.calls[0]![0] as {
      multicall3Address: string;
      batches: readonly string[];
    };
    expect(callArgs.multicall3Address).toBe(MULTICALL3_ADDRESS);
    expect(callArgs.batches).toHaveLength(1);
  });

  it("splits calls exceeding maxCallsPerMulticall into deterministic ordered batches", async () => {
    const batch1 = encodeAggregate3Result([
      { success: true, data: "0x01" },
      { success: true, data: "0x02" },
    ]);
    const batch2 = encodeAggregate3Result([{ success: true, data: "0x03" }]);
    const executor = fakeExecutor([batch1, batch2]);
    const service = new RpcService({ executor, maxCallsPerMulticall: 2 });

    const result = await service.multicallAtBlock({
      chain: 1,
      blockNumber: "18000000",
      calls: [
        { id: "1", target: TARGET_A, callData: "0x01" },
        { id: "2", target: TARGET_A, callData: "0x02" },
        { id: "3", target: TARGET_A, callData: "0x03" },
      ],
    });

    expect(result.results.map((entry) => entry.id)).toEqual(["1", "2", "3"]);
    expect(result.results.map((entry) => entry.returnData)).toEqual(["0x01", "0x02", "0x03"]);
    expect(executor.executeMulticallBatches).toHaveBeenCalledTimes(1);
    const callArgs = executor.executeMulticallBatches.mock.calls[0]![0] as { batches: readonly string[] };
    expect(callArgs.batches).toHaveLength(2);
  });

  it("rejects a block below the verified Multicall3 deployment block without calling the executor", async () => {
    const executor = fakeExecutor([]);
    const service = new RpcService({ executor });

    const belowDeployment = (MULTICALL3_ETHEREUM_MAINNET_DEPLOYMENT_BLOCK - 1n).toString();
    await expect(
      service.multicallAtBlock({
        chain: 1,
        blockNumber: belowDeployment,
        calls: [{ id: "1", target: TARGET_A, callData: "0x01" }],
      }),
    ).rejects.toMatchObject({ code: "MULTICALL_NOT_DEPLOYED_AT_BLOCK" });
    expect(executor.executeMulticallBatches).not.toHaveBeenCalled();
  });

  it("uses Base's chain identity and deployment boundary when configured", async () => {
    const executor = fakeExecutor([encodeAggregate3Result([{ success: true, data: "0x01" }])]);
    const service = new RpcService({ executor, chainId: 8453 });
    await expect(service.multicallAtBlock({ chain: "base", blockNumber: (MULTICALL3_BASE_MAINNET_DEPLOYMENT_BLOCK - 1n).toString(), calls: [{ id: "1", target: TARGET_A, callData: "0x01" }] })).rejects.toMatchObject({ code: "MULTICALL_NOT_DEPLOYED_AT_BLOCK" });
    await expect(service.multicallAtBlock({ chain: "ethereum", blockNumber: "18000000", calls: [{ id: "1", target: TARGET_A, callData: "0x01" }] })).rejects.toMatchObject({ code: "UNSUPPORTED_CHAIN" });
    expect(executor.executeMulticallBatches).not.toHaveBeenCalled();
  });

  it("rejects invalid requests (bad target, duplicate ids, empty calls) before touching the executor", async () => {
    const executor = fakeExecutor([]);
    const service = new RpcService({ executor });

    await expect(
      service.multicallAtBlock({ chain: 1, blockNumber: "18000000", calls: [] }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    await expect(
      service.multicallAtBlock({
        chain: 1,
        blockNumber: "18000000",
        calls: [
          { id: "dup", target: TARGET_A, callData: "0x01" },
          { id: "dup", target: TARGET_B, callData: "0x02" },
        ],
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    await expect(
      service.multicallAtBlock({
        chain: 1,
        blockNumber: "18000000",
        calls: [{ id: "1", target: "0xnot-an-address", callData: "0x01" }],
      }),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });

    expect(executor.executeMulticallBatches).not.toHaveBeenCalled();
  });

  it("rejects a batch-count mismatch from the executor", async () => {
    const executor = fakeExecutor([]);
    const service = new RpcService({ executor, maxCallsPerMulticall: 100 });

    await expect(
      service.multicallAtBlock({
        chain: 1,
        blockNumber: "18000000",
        calls: [{ id: "1", target: TARGET_A, callData: "0x01" }],
      }),
    ).rejects.toMatchObject({ code: "MULTICALL_NOT_DEPLOYED_AT_BLOCK" });
  });

  it("round-trips real aggregate3 encode/decode through the codec (sanity cross-check)", () => {
    const decoded = decodeAggregate3Result(
      encodeAggregate3Result([{ success: true, data: "0xdeadbeef" }]),
      1,
    );
    expect(decoded[0]).toEqual({ success: true, returnData: "0xdeadbeef" });
  });
});
