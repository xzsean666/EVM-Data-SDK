/**
 * Stable, hand-written shape for one committed Chainlink Ethereum Mainnet
 * standard Crypto/USD reference price feed entry.
 *
 * This interface itself is not generated. Only the array of these objects in
 * `ethereumMainnetPriceFeeds.generated.ts` is produced by
 * `scripts/update-chainlink-ethereum-feeds.mjs`. See
 * `docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MULTICALL3_UPGRADE.md` section 6.1 and
 * `docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md` section 7.
 */
export interface ChainlinkFeedDefinition {
  /** Stable identity, `ethereum-mainnet:<sourcePath>` (e.g. `ethereum-mainnet:eth-usd`). */
  readonly id: string;
  readonly chainId: 1;
  /** Standard `AggregatorV3Interface` proxy address; never the underlying aggregator. */
  readonly proxyAddress: string;
  /** Display symbol derived from the official feed name (e.g. `ETH`, `cbBTC`, `USD0++`). */
  readonly assetSymbol: string;
  readonly assetName: string | null;
  /** Canonical base asset ticker used for pair identity, as published by Chainlink. */
  readonly baseAsset: string;
  readonly quoteAsset: "USD";
  /**
   * Decimals reported by Chainlink's own feed metadata at generation time.
   * `ChainlinkService` compares this against the live `decimals()` call at
   * request time and fails that feed as `FEED_RESPONSE_INVALID` on mismatch.
   */
  readonly expectedDecimals: number;
  readonly heartbeatSeconds: string | null;
  /** Chainlink's own feed path slug (e.g. `eth-usd`), preserved for traceability. */
  readonly sourcePath: string;
}
