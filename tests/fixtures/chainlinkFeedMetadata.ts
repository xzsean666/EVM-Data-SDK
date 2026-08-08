/**
 * Fixture-shaped raw entries mimicking Chainlink's own
 * `feeds-mainnet.json` payload, used only by the deterministic
 * `scripts/update-chainlink-ethereum-feeds.mjs` generator tests. These are
 * hand-written minimal shapes, not a live snapshot; the real source is
 * fetched only by the manual maintainer command, never by tests.
 */

export const standardEthUsdFeed = {
  name: "ETH / USD",
  path: "eth-usd",
  proxyAddress: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  assetName: "Ethereum",
  heartbeat: 3600,
  decimals: 8,
  docs: {
    productType: "Price",
    productTypeCode: "RefPrice",
    productSubType: "Reference",
    assetClass: "Crypto",
    quoteAsset: "USD",
    baseAsset: "ETH",
  },
};

export const standardBtcUsdFeed = {
  name: "BTC / USD",
  path: "btc-usd",
  proxyAddress: "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c",
  assetName: "Bitcoin",
  heartbeat: 3600,
  decimals: 8,
  docs: {
    productType: "Price",
    productTypeCode: "RefPrice",
    productSubType: "Reference",
    assetClass: "Crypto",
    quoteAsset: "USD",
    baseAsset: "BTC",
  },
};

/** Missing `docs.baseAsset`, matching the real "U / USD" anomaly. */
export const missingBaseAssetFeed = {
  name: "U / USD",
  path: "u-usd",
  proxyAddress: "0xF6351B2dCF0110E76c71C1d319Af2f410454B6f3",
  assetName: null,
  heartbeat: 86400,
  decimals: 18,
  docs: {
    productType: "Price",
    productTypeCode: "RefPrice",
    productSubType: "Reference",
    assetClass: "Crypto",
    quoteAsset: "USD",
    baseAssetClic: "U_CR",
  },
};

/** SVR/shared-SVR variant, excluded by `secondaryProxyAddress`. */
export const svrFeed = {
  name: "ETH / USD",
  path: "eth-usd-svr",
  proxyAddress: "0x1111111111111111111111111111111111111111",
  secondaryProxyAddress: "0x2222222222222222222222222222222222222222",
  assetName: "Ethereum",
  heartbeat: 3600,
  decimals: 8,
  docs: {
    productType: "Price",
    productTypeCode: "RefPrice",
    productSubType: "Reference",
    assetClass: "Crypto",
    quoteAsset: "USD",
    baseAsset: "ETH",
  },
};

/** Hidden feed, excluded regardless of shutdown date. */
export const hiddenFeed = {
  name: "BAT / USD",
  path: "bat-usd",
  proxyAddress: "0x3333333333333333333333333333333333333333",
  assetName: "Basic Attention Token",
  heartbeat: 86400,
  decimals: 8,
  docs: {
    productType: "Price",
    productTypeCode: "RefPrice",
    productSubType: "Reference",
    assetClass: "Crypto",
    quoteAsset: "USD",
    baseAsset: "BAT",
    hidden: true,
    shutdownDate: "September 22nd, 2023",
  },
};

/** Deprecating feed with only a shutdown date, no hidden flag. */
export const shutdownFeed = {
  name: "DOLO / USD",
  path: "dolo-usd",
  proxyAddress: "0x4444444444444444444444444444444444444444",
  assetName: "Dolomite",
  heartbeat: 86400,
  decimals: 18,
  docs: {
    productType: "Price",
    productTypeCode: "RefPrice",
    productSubType: "Reference",
    assetClass: "Crypto",
    quoteAsset: "USD",
    baseAsset: "DOLO",
    shutdownDate: "April 29th, 2026",
  },
};

/** Non-USD quote, excluded. */
export const nonUsdFeed = {
  name: "EUR / USD",
  path: "eur-usd",
  proxyAddress: "0x5555555555555555555555555555555555555555",
  assetName: "Euro",
  heartbeat: 3600,
  decimals: 8,
  docs: {
    productType: "Price",
    productTypeCode: "RefPrice",
    productSubType: "Reference",
    assetClass: "Forex",
    quoteAsset: "EUR",
    baseAsset: "USD",
  },
};

/** Non-Crypto asset class, excluded even though quote is USD. */
export const nonCryptoFeed = {
  name: "XAU / USD",
  path: "xau-usd",
  proxyAddress: "0x6666666666666666666666666666666666666666",
  assetName: "Gold",
  heartbeat: 86400,
  decimals: 8,
  docs: {
    productType: "Price",
    productTypeCode: "RefPrice",
    productSubType: "Reference",
    assetClass: "Commodities",
    quoteAsset: "USD",
    baseAsset: "XAU",
  },
};

/** Not a RefPrice product type (e.g. NAV feed), excluded. */
export const calculatedFeed = {
  name: "JTRSY NAV",
  path: "jtrsy-nav-v2",
  proxyAddress: "0x7777777777777777777777777777777777777777",
  assetName: "JTRSY NAV",
  heartbeat: 97200,
  decimals: 6,
  docs: {
    productType: "NAVLink",
    productTypeCode: "NAV",
    assetClass: "U.S. Treasuries",
    baseAsset: "JTRSY",
  },
};

export const invalidProxyAddressFeed = {
  name: "BAD / USD",
  path: "bad-usd",
  proxyAddress: "not-an-address",
  assetName: "Bad",
  heartbeat: 3600,
  decimals: 8,
  docs: {
    productType: "Price",
    productTypeCode: "RefPrice",
    productSubType: "Reference",
    assetClass: "Crypto",
    quoteAsset: "USD",
    baseAsset: "BAD",
  },
};

export const invalidDecimalsFeed = {
  name: "BAD2 / USD",
  path: "bad2-usd",
  proxyAddress: "0x8888888888888888888888888888888888888888",
  assetName: "Bad2",
  heartbeat: 3600,
  decimals: 256,
  docs: {
    productType: "Price",
    productTypeCode: "RefPrice",
    productSubType: "Reference",
    assetClass: "Crypto",
    quoteAsset: "USD",
    baseAsset: "BAD2",
  },
};

export const missingPathFeed = {
  name: "BAD3 / USD",
  path: "",
  proxyAddress: "0x9999999999999999999999999999999999999999",
  assetName: "Bad3",
  heartbeat: 3600,
  decimals: 8,
  docs: {
    productType: "Price",
    productTypeCode: "RefPrice",
    productSubType: "Reference",
    assetClass: "Crypto",
    quoteAsset: "USD",
    baseAsset: "BAD3",
  },
};

/** Duplicate proxyAddress with `standardEthUsdFeed` under a different path/name. */
export const duplicateProxyAddressFeed = {
  name: "ETH2 / USD",
  path: "eth2-usd",
  proxyAddress: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
  assetName: "Ethereum Duplicate",
  heartbeat: 3600,
  decimals: 8,
  docs: {
    productType: "Price",
    productTypeCode: "RefPrice",
    productSubType: "Reference",
    assetClass: "Crypto",
    quoteAsset: "USD",
    baseAsset: "ETH",
  },
};

/** Duplicate name with `standardEthUsdFeed` under a different path/proxy. */
export const duplicateNameFeed = {
  name: "ETH / USD",
  path: "eth-usd-alt",
  proxyAddress: "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  assetName: "Ethereum Alt",
  heartbeat: 3600,
  decimals: 8,
  docs: {
    productType: "Price",
    productTypeCode: "RefPrice",
    productSubType: "Reference",
    assetClass: "Crypto",
    quoteAsset: "USD",
    baseAsset: "ETH",
  },
};
