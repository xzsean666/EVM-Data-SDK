import { describe, expect, it } from "vitest";
import { UniswapV4HistoricalPriceService } from "../../src/defi/uniswap/v4/UniswapV4HistoricalPriceService";
import { UNISWAP_V4_TOKEN_REGISTRY } from "../../src/defi/uniswap/v4/uniswapV4PoolRegistry";

describe("Uniswap V4 symbol lookup", () => {
  it("keeps ASTR configured with the canonical currency order", () => {
    const astr = UNISWAP_V4_TOKEN_REGISTRY.find((entry) => entry.tokenSymbol === "ASTR");
    expect(astr).toBeDefined();
    expect(astr?.currency0.symbol).toBe("USDC");
    expect(astr?.currency1.symbol).toBe("ASTR");
    expect(astr?.poolId).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("resolves a token symbol through the injected multicall port", async () => {
    const calls: Array<{ target: string; callData: string }> = [];
    const service = new UniswapV4HistoricalPriceService({
      rpcService: {
        async multicallAtBlock(request) {
          calls.push(...request.calls);
          return { chainId: 1, blockNumber: request.blockNumber, blockHash: "0xhash", blockTimestamp: "1", rpcEndpointId: "test", multicallBatches: 1, results: [{ id: request.calls[0]!.id, success: true, returnData: `0x${"00".repeat(32)}${"00".repeat(31)}01${"00".repeat(32)}${"00".repeat(32)}` }] };
        },
      },
    });
    await expect(service.getTokenPricesAtBlockUsd({ chain: 1, blockNumber: "1", tokens: ["ASTR"] })).rejects.toMatchObject({ code: "UNISWAP_V4_PRICE_DATA_UNAVAILABLE" });
    expect(calls).toHaveLength(0);
    await expect(service.getTokenPricesAtBlockUsd({ chain: 1, blockNumber: "25707989", tokens: ["ASTR"] })).rejects.toMatchObject({ code: "UNISWAP_V4_PRICE_DATA_UNAVAILABLE" });
    expect(calls[0]?.callData).toMatch(/^0xc815641c/);
  });
});
