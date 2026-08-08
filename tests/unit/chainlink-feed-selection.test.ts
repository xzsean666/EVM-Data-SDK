import { describe, expect, it } from "vitest";

import {
  buildFeedDefinition,
  isStandardEthereumCryptoUsdRefPriceFeed,
  renderGeneratedManifest,
  selectAndBuildFeeds,
} from "../../scripts/chainlinkFeedSelection.mjs";
import {
  calculatedFeed,
  duplicateNameFeed,
  duplicateProxyAddressFeed,
  hiddenFeed,
  invalidDecimalsFeed,
  invalidProxyAddressFeed,
  missingBaseAssetFeed,
  missingPathFeed,
  nonCryptoFeed,
  nonUsdFeed,
  shutdownFeed,
  standardBtcUsdFeed,
  standardEthUsdFeed,
  svrFeed,
} from "../fixtures/chainlinkFeedMetadata";

describe("isStandardEthereumCryptoUsdRefPriceFeed", () => {
  it("accepts a standard Crypto/USD reference price feed", () => {
    expect(isStandardEthereumCryptoUsdRefPriceFeed(standardEthUsdFeed)).toBe(true);
  });

  it("excludes an SVR/shared-SVR feed carrying secondaryProxyAddress", () => {
    expect(isStandardEthereumCryptoUsdRefPriceFeed(svrFeed)).toBe(false);
  });

  it("excludes a hidden feed", () => {
    expect(isStandardEthereumCryptoUsdRefPriceFeed(hiddenFeed)).toBe(false);
  });

  it("excludes a deprecating feed carrying only a shutdownDate (no hidden flag)", () => {
    expect(isStandardEthereumCryptoUsdRefPriceFeed(shutdownFeed)).toBe(false);
  });

  it("excludes a non-USD quote asset", () => {
    expect(isStandardEthereumCryptoUsdRefPriceFeed(nonUsdFeed)).toBe(false);
  });

  it("excludes a non-Crypto asset class even when the quote is USD", () => {
    expect(isStandardEthereumCryptoUsdRefPriceFeed(nonCryptoFeed)).toBe(false);
  });

  it("excludes a non-RefPrice product type (e.g. a calculated NAV feed)", () => {
    expect(isStandardEthereumCryptoUsdRefPriceFeed(calculatedFeed)).toBe(false);
  });

  it("handles a malformed/missing docs object without throwing", () => {
    expect(isStandardEthereumCryptoUsdRefPriceFeed({})).toBe(false);
    expect(isStandardEthereumCryptoUsdRefPriceFeed(null)).toBe(false);
    expect(isStandardEthereumCryptoUsdRefPriceFeed(undefined)).toBe(false);
  });
});

describe("buildFeedDefinition", () => {
  it("builds a well-formed ChainlinkFeedDefinition from a standard feed", () => {
    const feed = buildFeedDefinition(standardEthUsdFeed);
    expect(feed).toEqual({
      id: "ethereum-mainnet:eth-usd",
      chainId: 1,
      proxyAddress: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
      assetSymbol: "ETH",
      assetName: "Ethereum",
      baseAsset: "ETH",
      quoteAsset: "USD",
      expectedDecimals: 8,
      heartbeatSeconds: "3600",
      sourcePath: "eth-usd",
    });
    expect(Object.isFrozen(feed)).toBe(true);
  });

  it("falls back to deriving baseAsset from the name when docs.baseAsset is missing", () => {
    const feed = buildFeedDefinition(missingBaseAssetFeed);
    expect(feed.baseAsset).toBe("U");
    expect(feed.assetSymbol).toBe("U");
  });

  it("rejects a malformed proxy address", () => {
    expect(() => buildFeedDefinition(invalidProxyAddressFeed)).toThrow(/proxyAddress/);
  });

  it("rejects an out-of-range decimals value", () => {
    expect(() => buildFeedDefinition(invalidDecimalsFeed)).toThrow(/decimals/);
  });

  it("rejects a missing/empty path", () => {
    expect(() => buildFeedDefinition(missingPathFeed)).toThrow(/path/);
  });
});

describe("selectAndBuildFeeds", () => {
  it("selects only standard Crypto/USD feeds and sorts them by stable id", () => {
    const feeds = selectAndBuildFeeds([
      standardBtcUsdFeed,
      standardEthUsdFeed,
      svrFeed,
      hiddenFeed,
      shutdownFeed,
      nonUsdFeed,
      nonCryptoFeed,
      calculatedFeed,
    ]);

    expect(feeds.map((feed) => feed.id)).toEqual([
      "ethereum-mainnet:btc-usd",
      "ethereum-mainnet:eth-usd",
    ]);
    expect(Object.isFrozen(feeds)).toBe(true);
  });

  it("is order-independent: input order never changes the sorted output", () => {
    const forward = selectAndBuildFeeds([standardBtcUsdFeed, standardEthUsdFeed]);
    const reversed = selectAndBuildFeeds([standardEthUsdFeed, standardBtcUsdFeed]);
    expect(forward.map((feed) => feed.id)).toEqual(reversed.map((feed) => feed.id));
  });

  it("throws on a duplicate proxyAddress among selected feeds", () => {
    expect(() => selectAndBuildFeeds([standardEthUsdFeed, duplicateProxyAddressFeed])).toThrow(
      /Duplicate Chainlink feed proxyAddress/,
    );
  });

  it("throws on a duplicate name among selected feeds", () => {
    expect(() => selectAndBuildFeeds([standardEthUsdFeed, duplicateNameFeed])).toThrow(
      /Duplicate Chainlink feed name/,
    );
  });

  it("throws on a non-array input", () => {
    expect(() => selectAndBuildFeeds({})).toThrow(/JSON array/);
  });

  it("rejects an invalid entry surfaced through selection (address/decimals propagate)", () => {
    const withInvalidAddress = { ...invalidProxyAddressFeed, docs: { ...invalidProxyAddressFeed.docs } };
    expect(() => selectAndBuildFeeds([withInvalidAddress])).toThrow(/proxyAddress/);
  });
});

describe("renderGeneratedManifest", () => {
  const metadata = {
    sourceUrl: "https://reference-data-directory.vercel.app/feeds-mainnet.json",
    retrievedAt: "2026-08-07T00:00:00.000Z",
    sourceSha256: "deadbeef",
  };

  it("produces byte-identical output for identical input (deterministic)", () => {
    const feeds = selectAndBuildFeeds([standardBtcUsdFeed, standardEthUsdFeed]);
    const first = renderGeneratedManifest(feeds, metadata);
    const second = renderGeneratedManifest(feeds, metadata);
    expect(first).toBe(second);
  });

  it("embeds source url, retrieval time, sha256, and feed count in the header", () => {
    const feeds = selectAndBuildFeeds([standardEthUsdFeed]);
    const rendered = renderGeneratedManifest(feeds, metadata);
    expect(rendered).toContain(metadata.sourceUrl);
    expect(rendered).toContain(metadata.retrievedAt);
    expect(rendered).toContain(metadata.sourceSha256);
    expect(rendered).toContain("Feed count: 1");
  });

  it("renders a frozen array literal importing ChainlinkFeedDefinition", () => {
    const feeds = selectAndBuildFeeds([standardEthUsdFeed]);
    const rendered = renderGeneratedManifest(feeds, metadata);
    expect(rendered).toContain('import type { ChainlinkFeedDefinition } from "./ChainlinkFeedDefinition";');
    expect(rendered).toContain("Object.freeze([");
    expect(rendered).toContain('id: "ethereum-mainnet:eth-usd"');
    expect(rendered).toContain('sourcePath: "eth-usd"');
  });

  it("renders an empty array literal for zero feeds", () => {
    const rendered = renderGeneratedManifest([], metadata);
    expect(rendered).toContain("Feed count: 0");
    expect(rendered).toContain("Object.freeze([");
    expect(rendered).toContain("]);");
  });
});
