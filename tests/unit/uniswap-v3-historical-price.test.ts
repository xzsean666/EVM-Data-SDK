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
const poolTwo = "0x0000000000000000000000000000000000000004";
const usdc = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
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

  it("resolves a symbol to USD and selects the highest fee-tier price", async () => {
    const tokenManifest: readonly UniswapV3TokenDefinition[] = Object.freeze([
      Object.freeze({ id: "ethereum:uniswap-v3:one-usdc-500", chainId: 1 as const, protocol: "uniswap-v3" as const, tokenAddress: token0, tokenSymbol: "ONE", tokenDecimals: 18, poolAddress: pool, feeTier: 500, token0: Object.freeze({ address: token0, symbol: "ONE", decimals: 18 }), token1: Object.freeze({ address: usdc, symbol: "USDC", decimals: 6 }), quoteTokenAddress: usdc, poolDeploymentBlock: "1" }),
      Object.freeze({ id: "ethereum:uniswap-v3:one-usdc-3000", chainId: 1 as const, protocol: "uniswap-v3" as const, tokenAddress: token0, tokenSymbol: "ONE", tokenDecimals: 18, poolAddress: poolTwo, feeTier: 3000, token0: Object.freeze({ address: token0, symbol: "ONE", decimals: 18 }), token1: Object.freeze({ address: usdc, symbol: "USDC", decimals: 6 }), quoteTokenAddress: usdc, poolDeploymentBlock: "1" }),
    ]);
    const multicallAtBlock = vi.fn(async ({ calls }: { calls: readonly { id: string }[] }) => ({ chainId: 1 as const, blockNumber: "10", blockHash: `0x${"cd".repeat(32)}`, blockTimestamp: "1", rpcEndpointId: "fixture", multicallBatches: 1, results: calls.map((call) => ({ id: call.id, success: true, returnData: slot0(call.id.endsWith(poolTwo) ? 2n << 96n : 1n << 96n, 0) })) }));
    const result = await new UniswapV3HistoricalPriceService({ rpcService: { multicallAtBlock }, manifest: tokenManifest }).getTokenPriceAtBlock({ chain: "ethereum", blockNumber: "00010", token: "ONE" });
    expect(result.priceUsd).toBe("4000000000000");
    expect(result.feeTier).toBe(3000);
    expect(result.source).toBe("uniswap-v3");
  });

  it("batch-resolves tokens with one deduplicated RPC call", async () => {
    const two = "0x0000000000000000000000000000000000000006";
    const poolTwoUsdc = "0x0000000000000000000000000000000000000007";
    const wethPool = "0x0000000000000000000000000000000000000008";
    const batchManifest: readonly UniswapV3TokenDefinition[] = Object.freeze([
      Object.freeze({ id: "ethereum:uniswap-v3:one-usdc-500", chainId: 1 as const, protocol: "uniswap-v3" as const, tokenAddress: token0, tokenSymbol: "ONE", tokenDecimals: 18, poolAddress: pool, feeTier: 500, token0: Object.freeze({ address: token0, symbol: "ONE", decimals: 18 }), token1: Object.freeze({ address: usdc, symbol: "USDC", decimals: 6 }), quoteTokenAddress: usdc, poolDeploymentBlock: "1" }),
      Object.freeze({ id: "ethereum:uniswap-v3:two-weth-500", chainId: 1 as const, protocol: "uniswap-v3" as const, tokenAddress: two, tokenSymbol: "TWO", tokenDecimals: 18, poolAddress: poolTwoUsdc, feeTier: 500, token0: Object.freeze({ address: two, symbol: "TWO", decimals: 18 }), token1: Object.freeze({ address: WETH, symbol: "WETH", decimals: 18 }), quoteTokenAddress: WETH, poolDeploymentBlock: "1" }),
      Object.freeze({ id: "ethereum:uniswap-v3:weth-usdc-500-reference", chainId: 1 as const, protocol: "uniswap-v3" as const, tokenAddress: WETH, tokenSymbol: "WETH", tokenDecimals: 18, poolAddress: wethPool, feeTier: 500, token0: Object.freeze({ address: usdc, symbol: "USDC", decimals: 6 }), token1: Object.freeze({ address: WETH, symbol: "WETH", decimals: 18 }), quoteTokenAddress: usdc, poolDeploymentBlock: "1" }),
    ]);
    const multicallAtBlock = vi.fn(async ({ calls }: { calls: readonly { id: string }[] }) => ({ chainId: 1 as const, blockNumber: "10", blockHash: `0x${"ef".repeat(32)}`, blockTimestamp: "1", rpcEndpointId: "fixture", multicallBatches: 1, results: calls.map((call) => ({ id: call.id, success: true, returnData: slot0(1n << 96n, 0) })) }));
    const result = await new UniswapV3HistoricalPriceService({ rpcService: { multicallAtBlock }, manifest: batchManifest }).getTokenPricesAtBlockUsd({ chain: "ethereum", blockNumber: "10", tokens: ["ONE", "TWO"] });
    expect(multicallAtBlock).toHaveBeenCalledTimes(1);
    expect(multicallAtBlock.mock.calls[0]?.[0].calls).toHaveLength(3);
    expect(result.prices).toHaveLength(2);
    expect(result.failures).toHaveLength(0);
  });

  it("does not read non-USD WETH reverse pools when WETH is requested", async () => {
    const wethUniPool = "0x0000000000000000000000000000000000000009";
    const wethUsdcPool = "0x000000000000000000000000000000000000000a";
    const uni = "0x000000000000000000000000000000000000000b";
    const wethManifest: readonly UniswapV3TokenDefinition[] = Object.freeze([
      Object.freeze({ id: "ethereum:uniswap-v3:weth-uni-500", chainId: 1 as const, protocol: "uniswap-v3" as const, tokenAddress: WETH, tokenSymbol: "WETH", tokenDecimals: 18, poolAddress: wethUniPool, feeTier: 500, token0: Object.freeze({ address: uni, symbol: "UNI", decimals: 18 }), token1: Object.freeze({ address: WETH, symbol: "WETH", decimals: 18 }), quoteTokenAddress: uni, poolDeploymentBlock: "1" }),
      Object.freeze({ id: "ethereum:uniswap-v3:weth-usdc-500", chainId: 1 as const, protocol: "uniswap-v3" as const, tokenAddress: WETH, tokenSymbol: "WETH", tokenDecimals: 18, poolAddress: wethUsdcPool, feeTier: 500, token0: Object.freeze({ address: usdc, symbol: "USDC", decimals: 6 }), token1: Object.freeze({ address: WETH, symbol: "WETH", decimals: 18 }), quoteTokenAddress: usdc, poolDeploymentBlock: "1" }),
    ]);
    const multicallAtBlock = vi.fn(async ({ calls }: { calls: readonly { id: string }[] }) => ({ chainId: 1 as const, blockNumber: "10", blockHash: `0x${"12".repeat(32)}`, blockTimestamp: "1", rpcEndpointId: "fixture", multicallBatches: 1, results: calls.map((call) => ({ id: call.id, success: true, returnData: slot0(1n << 96n, 0) })) }));
    const result = await new UniswapV3HistoricalPriceService({ rpcService: { multicallAtBlock }, manifest: wethManifest }).getTokenPricesAtBlockUsd({ chain: "ethereum", blockNumber: "10", tokens: ["WETH"] });
    expect(multicallAtBlock).toHaveBeenCalledTimes(1);
    expect(multicallAtBlock.mock.calls[0]?.[0].calls).toHaveLength(1);
    expect(result.prices).toHaveLength(1);
    expect(result.prices[0]?.quoteToken.symbol).toBe("USDC");
  });
});
