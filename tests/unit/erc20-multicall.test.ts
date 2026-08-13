import { describe, expect, it, vi } from "vitest";

import { decodeErc20Read, encodeErc20Read } from "../../src/rpc/Erc20MulticallCodec";
import { RpcService, type ArchiveRpcMulticallExecutor } from "../../src/rpc/RpcService";

const TOKEN = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OWNER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SPENDER = "0xcccccccccccccccccccccccccccccccccccccccc";
const BLOCK_HASH = `0x${"ab".repeat(32)}`;
const word = (value: bigint) => value.toString(16).padStart(64, "0");
const addressWord = (address: string) => address.slice(2).padStart(64, "0");

function aggregateResult(data: readonly { success: boolean; value: string }[]): string {
  const bodies: string[] = [];
  let offset = BigInt(data.length * 32);
  for (const item of data) {
    const hex = item.value.slice(2);
    const body = `${word(item.success ? 1n : 0n)}${word(64n)}${word(BigInt(hex.length / 2))}${hex.padEnd(Math.ceil(hex.length / 64) * 64, "0")}`;
    bodies.push(body);
    offset += BigInt(body.length / 2);
  }
  let cursor = BigInt(data.length * 32);
  const offsets = data.map((_, index) => {
    const current = cursor;
    cursor += BigInt(bodies[index]!.length / 2);
    return word(current);
  });
  return `0x${word(32n)}${word(BigInt(data.length))}${offsets.join("")}${bodies.join("")}`;
}

describe("ERC-20 Multicall3 reads", () => {
  it("encodes balanceOf, allowance, and metadata methods", () => {
    expect(encodeErc20Read({ id: "b", tokenAddress: TOKEN, method: "balanceOf", owner: OWNER })).toBe(`0x70a08231${addressWord(OWNER)}`);
    expect(encodeErc20Read({ id: "a", tokenAddress: TOKEN, method: "allowance", owner: OWNER, spender: SPENDER })).toBe(`0xdd62ed3e${addressWord(OWNER)}${addressWord(SPENDER)}`);
    expect(encodeErc20Read({ id: "d", tokenAddress: TOKEN, method: "decimals" })).toBe("0x313ce567");
  });

  it("decodes uint and bytes32 text results", () => {
    expect(decodeErc20Read("balanceOf", `0x${word(123n)}`)).toBe("123");
    expect(decodeErc20Read("symbol", `0x${Buffer.from("USDC").toString("hex").padEnd(64, "0")}`)).toBe("USDC");
  });

  it("batches calls and preserves per-call failures", async () => {
    const executor: ArchiveRpcMulticallExecutor = {
      executeMulticallBatches: vi.fn().mockResolvedValue({
        blockHash: BLOCK_HASH,
        blockTimestamp: "1700000000",
        rpcEndpointId: "fixture",
        batchReturnData: [aggregateResult([
          { success: true, value: `0x${word(42n)}` },
          { success: false, value: "0x08c379a0" },
        ])],
      }),
    };
    const result = await new RpcService({ executor }).multicallErc20AtBlock({
      chain: "ethereum",
      blockNumber: "14353601",
      calls: [
        { id: "balance", tokenAddress: TOKEN, method: "balanceOf", owner: OWNER },
        { id: "decimals", tokenAddress: TOKEN, method: "decimals" },
      ],
    });
    expect(result.blockNumber).toBe("14353601");
    expect(result.results).toEqual([
      { id: "balance", tokenAddress: TOKEN, method: "balanceOf", success: true, value: "42", error: null },
      { id: "decimals", tokenAddress: TOKEN, method: "decimals", success: false, value: null, error: "CALL_FAILED" },
    ]);
  });

  it("resolves the latest block when blockNumber is omitted", async () => {
    const executor: ArchiveRpcMulticallExecutor = {
      findLatestBlockNumber: vi.fn().mockResolvedValue({ blockNumber: "14353602", rpcEndpointId: "fixture" }),
      executeMulticallBatches: vi.fn().mockResolvedValue({
        blockHash: BLOCK_HASH,
        blockTimestamp: "1700000000",
        rpcEndpointId: "fixture",
        batchReturnData: [aggregateResult([{ success: true, value: `0x${word(7n)}` }])],
      }),
    };
    const result = await new RpcService({ executor }).multicallErc20AtBlock({
      chain: "ethereum",
      calls: [{ id: "balance", tokenAddress: TOKEN, method: "balanceOf", owner: OWNER }],
    });
    expect(result.blockNumber).toBe("14353602");
    expect(executor.findLatestBlockNumber).toHaveBeenCalledOnce();
  });
});
