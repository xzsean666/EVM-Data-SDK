import { describe, expect, it, vi } from "vitest";
import { decodeUniswapV3Slot0 } from "../../src/defi/UniswapV3Slot0Codec";
import { getSqrtRatioAtTick } from "../../src/defi/UniswapV3PriceMath";
import { UniswapV3HistoricalPriceService } from "../../src/defi/UniswapV3HistoricalPriceService";
import type { UniswapV3TokenDefinition } from "../../src/defi/UniswapV3TokenDefinition";

const word = (value: bigint) => value.toString(16).padStart(64, "0");
const slot0 = (sqrt: bigint, tick: number) => `0x${[word(sqrt), word(BigInt.asUintN(256, BigInt(tick))), word(0n), word(1n), word(1n), word(0n), word(1n)].join("")}`;
const token0 = "0x0000000000000000000000000000000000000001";
const token1 = "0x0000000000000000000000000000000000000002";
const pool = "0x0000000000000000000000000000000000000003";
const manifest: readonly UniswapV3TokenDefinition[] = Object.freeze([
  Object.freeze({ id: "ethereum:uniswap-v3:one-two", chainId: 1 as const, protocol: "uniswap-v3" as const, tokenAddress: token0, tokenSymbol: "ONE", tokenDecimals: 18, poolAddress: pool, feeTier: 500, token0: Object.freeze({ address: token0, symbol: "ONE", decimals: 18 }), token1: Object.freeze({ address: token1, symbol: "TWO", decimals: 6 }), quoteTokenAddress: token1, poolDeploymentBlock: "1" }),
  Object.freeze({ id: "ethereum:uniswap-v3:two-one", chainId: 1 as const, protocol: "uniswap-v3" as const, tokenAddress: token1, tokenSymbol: "TWO", tokenDecimals: 6, poolAddress: pool, feeTier: 500, token0: Object.freeze({ address: token0, symbol: "ONE", decimals: 18 }), token1: Object.freeze({ address: token1, symbol: "TWO", decimals: 6 }), quoteTokenAddress: token0, poolDeploymentBlock: "1" }),
]);

describe("Uniswap V3 historical price", () => {
  it("decodes signed ticks and canonical TickMath zero", () => {
    expect(decodeUniswapV3Slot0(slot0(1n << 96n, -1)).tick).toBe(-1);
    expect(getSqrtRatioAtTick(0)).toBe(1n << 96n);
  });

  it("deduplicates a shared pool and maps both token orientations", async () => {
    const multicallAtBlock = vi.fn(async () => ({ chainId: 1 as const, blockNumber: "10", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1", rpcEndpointId: "fixture", multicallBatches: 1, results: [{ id: `uniswap-v3::${pool}`, success: true, returnData: slot0(1n << 96n, 0) }] }));
    const result = await new UniswapV3HistoricalPriceService({ rpcService: { multicallAtBlock }, manifest }).getTokenPricesAtBlock({ chain: "ethereum", blockNumber: "00010" });
    expect(multicallAtBlock).toHaveBeenCalledTimes(1);
    expect(result.prices).toHaveLength(2);
    expect(result.summary.distinctPools).toBe(1);
  });

  it("accepts an address pair and returns every configured fee tier", async () => {
    const multicallAtBlock = vi.fn(async ({ calls }: { calls: readonly { id: string }[] }) => ({ chainId: 1 as const, blockNumber: "10", blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1", rpcEndpointId: "fixture", multicallBatches: 1, results: calls.map((call) => ({ id: call.id, success: true, returnData: slot0(1n << 96n, 0) })) }));
    const result = await new UniswapV3HistoricalPriceService({ rpcService: { multicallAtBlock }, manifest }).getTokenPricesAtBlock({ chain: 1, blockNumber: "10", tokenPair: ["TWO", "ONE"] });
    expect(result.prices).toHaveLength(2);
    expect(result.summary.distinctPools).toBe(1);
  });
});
