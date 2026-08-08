import { describe, expect, it } from "vitest";

import { ETHEREUM_MAINNET_CHAINLINK_PRICE_FEEDS } from "../../src/chainlink/ethereumMainnetPriceFeeds.generated";
import { adapterCalls } from "../../src/defi/DeFiProtocolAdapter";
import { DEFI_TOKEN_REGISTRY } from "../../src/defi/defiTokenRegistry";

describe("DeFi registry Chainlink-underlying constraint", () => {
  it("contains only unique token identities whose every underlying maps to a committed Chainlink asset", () => {
    const feedAssets = new Set(ETHEREUM_MAINNET_CHAINLINK_PRICE_FEEDS.flatMap((feed) => [feed.baseAsset, feed.assetSymbol]));
    const ids = DEFI_TOKEN_REGISTRY.map((token) => token.id);
    const addresses = DEFI_TOKEN_REGISTRY.map((token) => `${token.chainId}:${token.tokenAddress.toLowerCase()}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(addresses).size).toBe(addresses.length);
    expect(DEFI_TOKEN_REGISTRY.filter((token) => token.chainId === 1).length).toBeGreaterThan(42);
    expect(DEFI_TOKEN_REGISTRY.filter((token) => token.chainId === 8453).length).toBeGreaterThan(37);
    for (const token of DEFI_TOKEN_REGISTRY) {
      for (const underlying of token.underlyings) {
        expect(underlying.chainlinkAssetSymbol, `${token.id}:${underlying.symbol}`).toEqual(expect.any(String));
        if (!feedAssets.has(underlying.chainlinkAssetSymbol!)) {
          throw new Error(`${token.id}:${underlying.symbol} maps to absent Chainlink asset ${underlying.chainlinkAssetSymbol}`);
        }
      }
    }
  });

  it("produces a single collision-free Multicall3 call plan for every dynamic registry token", () => {
    const calls = DEFI_TOKEN_REGISTRY.flatMap(adapterCalls);
    expect(new Set(calls.map((call) => call.id)).size).toBe(calls.length);
    expect(calls.every((call) => /^0x[0-9a-fA-F]{40}$/.test(call.target))).toBe(true);
    for (const token of DEFI_TOKEN_REGISTRY) {
      const planned = adapterCalls(token);
      expect(planned.length === 0).toBe(token.adapter === "fixed-ratio");
    }
  });
});
