import { describe, expect, it } from "vitest";

import { ETHEREUM_MAINNET_CHAINLINK_PRICE_FEEDS } from "../../src/chainlink/ethereumMainnetPriceFeeds.generated";
import { UNISWAP_V3_TOKEN_REGISTRY, validateUniswapV3TokenRegistry } from "../../src/defi/uniswapV3TokenRegistry";

describe("Uniswap V3 token registry", () => {
  it("validates every committed pool and covers all currently pool-backed Chainlink assets", () => {
    validateUniswapV3TokenRegistry(UNISWAP_V3_TOKEN_REGISTRY);

    const chainlinkToTokenSymbol: Readonly<Record<string, string>> = Object.freeze({
      AVAX: "WAVAX",
      BTC: "WBTC",
      ETH: "WETH",
      TAO: "WTAO",
    });
    const registrySymbols = new Set(UNISWAP_V3_TOKEN_REGISTRY.flatMap((entry) => [
      entry.tokenSymbol.toUpperCase(),
      entry.token0.symbol.toUpperCase(),
      entry.token1.symbol.toUpperCase(),
    ]));
    const currentlyUnbacked = new Set(["RDNT", "TRUMP", "USD0++"]);
    const missing = ETHEREUM_MAINNET_CHAINLINK_PRICE_FEEDS
      .map((feed) => feed.assetSymbol)
      .filter((symbol) => !registrySymbols.has((chainlinkToTokenSymbol[symbol] ?? symbol).toUpperCase()) && !currentlyUnbacked.has(symbol));

    expect(missing).toEqual([]);
    expect(UNISWAP_V3_TOKEN_REGISTRY.length).toBeGreaterThanOrEqual(ETHEREUM_MAINNET_CHAINLINK_PRICE_FEEDS.length);
  });

  it("keeps every pool identity unique", () => {
    const identities = UNISWAP_V3_TOKEN_REGISTRY.map((entry) =>
      `${entry.poolAddress}|${entry.tokenAddress}|${entry.quoteTokenAddress}|${entry.feeTier}`,
    );
    expect(new Set(identities).size).toBe(identities.length);
  });
});
