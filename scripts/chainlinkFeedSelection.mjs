/**
 * Pure Chainlink Ethereum Mainnet feed metadata selection, validation, and
 * generated-manifest rendering.
 *
 * This module owns only deterministic, network-free logic: given already
 * fetched/parsed `feeds-mainnet.json` entries, decide which are standard
 * Ethereum Mainnet Crypto/USD reference price feeds (see
 * `docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MULTICALL3_UPGRADE.md` section 6.2),
 * validate their shape, and render the committed generated manifest source
 * text. It has no `fetch`, no filesystem access, and no knowledge of the CLI
 * entry point — that belongs to `update-chainlink-ethereum-feeds.mjs`. See
 * `chainlinkFeedSelection.d.mts` for the exported types used by TypeScript
 * tests.
 */

const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * Applies the exact v0.4 selection rule to one raw `feeds-mainnet.json`
 * entry: standard (non-SVR) Ethereum Mainnet Crypto/USD reference price
 * feed, not hidden, not carrying a shutdown date.
 */
export function isStandardEthereumCryptoUsdRefPriceFeed(entry) {
  const docs = entry && typeof entry === "object" ? entry.docs ?? {} : {};
  return (
    docs.productTypeCode === "RefPrice" &&
    docs.quoteAsset === "USD" &&
    docs.assetClass === "Crypto" &&
    entry?.secondaryProxyAddress === undefined &&
    docs.hidden !== true &&
    docs.shutdownDate === undefined
  );
}

function deriveAssetSymbol(entry) {
  const name = typeof entry?.name === "string" ? entry.name : "";
  const [symbol] = name.split(" / ");
  return (symbol ?? "").trim();
}

function deriveBaseAsset(entry, assetSymbol) {
  const declared = entry?.docs?.baseAsset;
  if (typeof declared === "string" && declared.length > 0) {
    return declared;
  }
  return assetSymbol.toUpperCase();
}

function deriveHeartbeatSeconds(entry) {
  const heartbeat = entry?.heartbeat;
  if (typeof heartbeat !== "number" || !Number.isFinite(heartbeat) || heartbeat < 0) {
    return null;
  }
  return String(Math.trunc(heartbeat));
}

/**
 * Builds one validated `ChainlinkFeedDefinition`-shaped plain object from a
 * raw entry already known to pass `isStandardEthereumCryptoUsdRefPriceFeed`.
 * Throws a descriptive `Error` for a malformed proxy address, decimals
 * value, or unusable name; callers decide how to aggregate/report these.
 */
export function buildFeedDefinition(entry) {
  const path = entry?.path;
  if (typeof path !== "string" || path.length === 0) {
    throw new Error(`Chainlink feed entry "${entry?.name ?? "<unknown>"}" is missing a usable path.`);
  }
  const proxyAddress = entry?.proxyAddress;
  if (typeof proxyAddress !== "string" || !ADDRESS_PATTERN.test(proxyAddress)) {
    throw new Error(`Chainlink feed "${path}" has an invalid proxyAddress.`);
  }
  const decimals = entry?.decimals;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error(`Chainlink feed "${path}" has an invalid decimals value.`);
  }

  const assetSymbol = deriveAssetSymbol(entry);
  if (assetSymbol.length === 0) {
    throw new Error(`Chainlink feed "${path}" has no usable asset symbol in its name.`);
  }

  return Object.freeze({
    id: `ethereum-mainnet:${path}`,
    chainId: 1,
    proxyAddress,
    assetSymbol,
    assetName: typeof entry?.assetName === "string" && entry.assetName.length > 0 ? entry.assetName : null,
    baseAsset: deriveBaseAsset(entry, assetSymbol),
    quoteAsset: "USD",
    expectedDecimals: decimals,
    heartbeatSeconds: deriveHeartbeatSeconds(entry),
    sourcePath: path,
  });
}

/**
 * Filters, validates, and deterministically sorts raw `feeds-mainnet.json`
 * entries into the committed feed manifest shape. Throws on any duplicate
 * `id`, `proxyAddress`, or `name` among the selected feeds so a maintainer
 * must resolve the collision before it reaches the generated file.
 */
export function selectAndBuildFeeds(rawEntries) {
  if (!Array.isArray(rawEntries)) {
    throw new Error("Chainlink feed metadata must be a JSON array.");
  }

  const selected = rawEntries.filter((entry) => isStandardEthereumCryptoUsdRefPriceFeed(entry));
  const feeds = selected.map((entry) => buildFeedDefinition(entry));

  const seenIds = new Set();
  const seenProxyAddresses = new Set();
  const seenNames = new Set();
  selected.forEach((entry, index) => {
    const feed = feeds[index];

    if (seenIds.has(feed.id)) {
      throw new Error(`Duplicate Chainlink feed id "${feed.id}".`);
    }
    seenIds.add(feed.id);

    const normalizedAddress = feed.proxyAddress.toLowerCase();
    if (seenProxyAddresses.has(normalizedAddress)) {
      throw new Error(`Duplicate Chainlink feed proxyAddress "${feed.proxyAddress}".`);
    }
    seenProxyAddresses.add(normalizedAddress);

    const name = typeof entry?.name === "string" ? entry.name : "";
    if (seenNames.has(name)) {
      throw new Error(`Duplicate Chainlink feed name "${name}".`);
    }
    seenNames.add(name);
  });

  return Object.freeze([...feeds].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}

/**
 * Renders the full generated-manifest TypeScript source text for a set of
 * already-selected, already-sorted feeds. Pure and deterministic: identical
 * `feeds`/`metadata` input always produces byte-identical output.
 */
export function renderGeneratedManifest(feeds, metadata) {
  const lines = [];
  lines.push("/**");
  lines.push(" * GENERATED FILE — do not edit by hand.");
  lines.push(" *");
  lines.push(" * Produced by `scripts/update-chainlink-ethereum-feeds.mjs`. Regenerate with:");
  lines.push(" *");
  lines.push(" *   pnpm update:chainlink-feeds");
  lines.push(" *");
  lines.push(" * See `docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MULTICALL3_UPGRADE.md` section 6 and");
  lines.push(" * `docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md` section 7 before editing the");
  lines.push(" * generator or committing a refreshed manifest. Review added, removed,");
  lines.push(" * changed-address, changed-decimals, changed-heartbeat, SVR, and deprecating");
  lines.push(" * entries against Chainlink's official address page before committing.");
  lines.push(" *");
  lines.push(` * Source: ${metadata.sourceUrl}`);
  lines.push(` * Retrieved: ${metadata.retrievedAt}`);
  lines.push(` * Source SHA-256: ${metadata.sourceSha256}`);
  lines.push(` * Feed count: ${feeds.length}`);
  lines.push(" */");
  lines.push("");
  lines.push('import type { ChainlinkFeedDefinition } from "./ChainlinkFeedDefinition";');
  lines.push("");
  lines.push(
    "export const ETHEREUM_MAINNET_CHAINLINK_PRICE_FEEDS: readonly ChainlinkFeedDefinition[] = Object.freeze([",
  );
  for (const feed of feeds) {
    lines.push("  Object.freeze({");
    lines.push(`    id: ${JSON.stringify(feed.id)},`);
    lines.push("    chainId: 1,");
    lines.push(`    proxyAddress: ${JSON.stringify(feed.proxyAddress)},`);
    lines.push(`    assetSymbol: ${JSON.stringify(feed.assetSymbol)},`);
    lines.push(`    assetName: ${feed.assetName === null ? "null" : JSON.stringify(feed.assetName)},`);
    lines.push(`    baseAsset: ${JSON.stringify(feed.baseAsset)},`);
    lines.push('    quoteAsset: "USD",');
    lines.push(`    expectedDecimals: ${feed.expectedDecimals},`);
    lines.push(
      `    heartbeatSeconds: ${feed.heartbeatSeconds === null ? "null" : JSON.stringify(feed.heartbeatSeconds)},`,
    );
    lines.push(`    sourcePath: ${JSON.stringify(feed.sourcePath)},`);
    lines.push("  }),");
  }
  lines.push("]);");
  lines.push("");
  return lines.join("\n");
}
