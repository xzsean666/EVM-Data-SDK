import { createHash } from "node:crypto";

import { chainlinkPriceDataUnavailable } from "../domain/errors";
import {
  parseChainlinkTokenPricesAtBlockRequest,
  type ChainlinkFeedFailure,
  type ChainlinkFeedFailureCode,
  type ChainlinkPriceAtBlock,
  type ChainlinkTokenPricesAtBlockRequest,
  type ChainlinkTokenPricesAtBlockResult,
} from "../domain/chainlinkModels";
import type {
  MulticallAtBlockCall,
  MulticallAtBlockCallResult,
  MulticallAtBlockRequest,
  MulticallAtBlockResult,
} from "../domain/rpcModels";
import type { ChainlinkFeedDefinition } from "./ChainlinkFeedDefinition";
import {
  DECIMALS_SELECTOR,
  LATEST_ROUND_DATA_SELECTOR,
  decodeDecimals,
  decodeLatestRoundData,
  formatFixedPointPrice,
} from "./ChainlinkRoundDataCodec";
import { ETHEREUM_MAINNET_CHAINLINK_PRICE_FEEDS } from "./ethereumMainnetPriceFeeds.generated";

/**
 * Port implemented by `RpcService`. `ChainlinkService` owns the complete
 * built-in feed manifest query, Multicall3 call batching, per-feed
 * `latestRoundData()`/`decimals()` validation, and partial-success
 * aggregation (upgrade doc sections 3.1/7). It has no endpoint URL, proxy,
 * health, or retry knowledge of its own — that belongs entirely to the
 * injected `RpcService` (and, beneath it, `EthereumArchiveRpcExecutor`).
 */
export interface ChainlinkMulticallService {
  multicallAtBlock(request: MulticallAtBlockRequest): Promise<MulticallAtBlockResult>;
}

export interface ChainlinkServiceOptions {
  readonly rpcService: ChainlinkMulticallService;
  /** Defaults to the committed `ETHEREUM_MAINNET_CHAINLINK_PRICE_FEEDS` manifest. */
  readonly manifest?: readonly ChainlinkFeedDefinition[];
}

type FeedEvaluation =
  | { readonly success: true; readonly price: ChainlinkPriceAtBlock }
  | { readonly success: false; readonly failure: ChainlinkFeedFailure };

/**
 * Public `client.chainlink.getTokenPricesAtBlock()` implementation (upgrade
 * doc section 3.1). Always evaluates the complete enabled manifest; there is
 * no token selector. See `docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MULTICALL3_UPGRADE.md`.
 */
export class ChainlinkService {
  private readonly rpcService: ChainlinkMulticallService;
  private readonly manifest: readonly ChainlinkFeedDefinition[];
  private readonly registryVersion: string;

  constructor(options: ChainlinkServiceOptions) {
    this.rpcService = options.rpcService;
    this.manifest = options.manifest ?? ETHEREUM_MAINNET_CHAINLINK_PRICE_FEEDS;
    this.registryVersion = computeRegistryVersion(this.manifest);
  }

  async getTokenPricesAtBlock(
    request: ChainlinkTokenPricesAtBlockRequest,
  ): Promise<ChainlinkTokenPricesAtBlockResult> {
    const normalized = parseChainlinkTokenPricesAtBlockRequest(request);

    const calls: MulticallAtBlockCall[] = [];
    for (const feed of this.manifest) {
      calls.push({
        id: latestRoundDataCallId(feed),
        target: feed.proxyAddress,
        callData: LATEST_ROUND_DATA_SELECTOR,
        allowFailure: true,
      });
      calls.push({
        id: decimalsCallId(feed),
        target: feed.proxyAddress,
        callData: DECIMALS_SELECTOR,
        allowFailure: true,
      });
    }

    const multicallResult = await this.rpcService.multicallAtBlock({
      chain: 1,
      blockNumber: normalized.blockNumber,
      calls,
      ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
    });

    const resultsById = new Map<string, MulticallAtBlockCallResult>();
    for (const result of multicallResult.results) {
      resultsById.set(result.id, result);
    }

    const prices: ChainlinkPriceAtBlock[] = [];
    const failures: ChainlinkFeedFailure[] = [];

    for (const feed of this.manifest) {
      const latestRoundDataResult = resultsById.get(latestRoundDataCallId(feed));
      const decimalsResult = resultsById.get(decimalsCallId(feed));

      const evaluation =
        latestRoundDataResult === undefined || decimalsResult === undefined
          ? makeFailure(
              feed,
              "FEED_RESPONSE_INVALID",
              "Multicall result is missing this feed's call results.",
            )
          : evaluateFeed(
              feed,
              latestRoundDataResult,
              decimalsResult,
              normalized.blockNumber,
              multicallResult.blockTimestamp,
            );

      if (evaluation.success) {
        prices.push(evaluation.price);
      } else {
        failures.push(evaluation.failure);
      }
    }

    if (prices.length === 0) {
      throw chainlinkPriceDataUnavailable(
        "No Chainlink feed in the built-in manifest resolved a valid price at this block.",
      );
    }

    return Object.freeze({
      chainId: 1,
      blockNumber: normalized.blockNumber,
      blockHash: multicallResult.blockHash,
      blockTimestamp: multicallResult.blockTimestamp,
      registryVersion: this.registryVersion,
      rpcEndpointId: multicallResult.rpcEndpointId,
      executionMode: "multicall3",
      prices: Object.freeze(prices),
      failures: Object.freeze(failures),
      summary: Object.freeze({
        configuredFeeds: this.manifest.length,
        requestedFeeds: this.manifest.length,
        succeededFeeds: prices.length,
        failedFeeds: failures.length,
        multicallBatches: multicallResult.multicallBatches,
        partial: failures.length > 0,
      }),
    });
  }
}

function latestRoundDataCallId(feed: ChainlinkFeedDefinition): string {
  return `${feed.id}::latestRoundData`;
}

function decimalsCallId(feed: ChainlinkFeedDefinition): string {
  return `${feed.id}::decimals`;
}

function makeFailure(
  feed: ChainlinkFeedDefinition,
  code: ChainlinkFeedFailureCode,
  message: string,
): FeedEvaluation {
  return {
    success: false,
    failure: Object.freeze({
      feedId: feed.id,
      assetSymbol: feed.assetSymbol,
      feedAddress: feed.proxyAddress,
      code,
      retryable: false,
      message,
    }),
  };
}

function evaluateFeed(
  feed: ChainlinkFeedDefinition,
  latestRoundDataResult: MulticallAtBlockCallResult,
  decimalsResult: MulticallAtBlockCallResult,
  blockNumber: string,
  blockTimestamp: string,
): FeedEvaluation {
  if (!latestRoundDataResult.success) {
    return makeFailure(feed, "FEED_CALL_REVERTED", "Chainlink latestRoundData() call reverted.");
  }
  if (latestRoundDataResult.returnData === "0x") {
    return makeFailure(
      feed,
      "FEED_NOT_DEPLOYED_AT_BLOCK",
      "Chainlink feed proxy has no deployed code at this block.",
    );
  }

  let roundData;
  try {
    roundData = decodeLatestRoundData(latestRoundDataResult.returnData);
  } catch {
    return makeFailure(feed, "FEED_RESPONSE_INVALID", "Chainlink latestRoundData() returned malformed data.");
  }

  if (roundData.answer <= 0n || roundData.updatedAt <= 0n) {
    return makeFailure(feed, "FEED_ROUND_UNAVAILABLE", "Chainlink feed has no available round at this block.");
  }

  const blockTimestampValue = BigInt(blockTimestamp);
  if (roundData.startedAt > roundData.updatedAt || roundData.updatedAt > blockTimestampValue) {
    return makeFailure(
      feed,
      "FEED_ANSWER_INVALID",
      "Chainlink feed round timestamps are inconsistent with the block.",
    );
  }
  if (roundData.answeredInRound < roundData.roundId) {
    return makeFailure(
      feed,
      "FEED_ANSWER_INVALID",
      "Chainlink feed round data is stale relative to its own round id.",
    );
  }

  if (!decimalsResult.success) {
    return makeFailure(feed, "FEED_RESPONSE_INVALID", "Chainlink decimals() call reverted.");
  }
  let decimals: number;
  try {
    decimals = decodeDecimals(decimalsResult.returnData);
  } catch {
    return makeFailure(feed, "FEED_RESPONSE_INVALID", "Chainlink decimals() returned malformed data.");
  }
  if (decimals !== feed.expectedDecimals) {
    return makeFailure(
      feed,
      "FEED_RESPONSE_INVALID",
      `Chainlink feed decimals() returned ${decimals} but the committed manifest expects ${feed.expectedDecimals}.`,
    );
  }

  const ageSeconds = blockTimestampValue - roundData.updatedAt;
  const isStale = feed.heartbeatSeconds === null ? null : ageSeconds > BigInt(feed.heartbeatSeconds);

  return {
    success: true,
    price: Object.freeze({
      feedId: feed.id,
      tokenSymbol: feed.assetSymbol,
      asset: Object.freeze({ symbol: feed.assetSymbol, name: feed.assetName }),
      pair: Object.freeze({ base: feed.baseAsset, quote: "USD" as const }),
      feedAddress: feed.proxyAddress,
      blockNumber,
      rawAnswer: roundData.answer.toString(10),
      price: formatFixedPointPrice(roundData.answer, decimals),
      decimals,
      roundId: roundData.roundId.toString(10),
      startedAt: roundData.startedAt.toString(10),
      updatedAt: roundData.updatedAt.toString(10),
      answeredInRound: roundData.answeredInRound.toString(10),
      ageSeconds: ageSeconds.toString(10),
      heartbeatSeconds: feed.heartbeatSeconds,
      isStale,
      provider: "chainlink" as const,
    }),
  };
}

/**
 * Deterministic content hash of the committed manifest, used as
 * `ChainlinkTokenPricesAtBlockResult.registryVersion`. Depends only on the
 * frozen manifest passed at construction time, so it is stable across
 * processes given the same manifest and needs no runtime state of its own.
 */
function computeRegistryVersion(manifest: readonly ChainlinkFeedDefinition[]): string {
  const hash = createHash("sha256");
  for (const feed of manifest) {
    hash.update(feed.id);
    hash.update("|");
    hash.update(feed.proxyAddress.toLowerCase());
    hash.update("|");
    hash.update(String(feed.expectedDecimals));
    hash.update("|");
    hash.update(feed.heartbeatSeconds ?? "");
    hash.update("\n");
  }
  return `sha256:${hash.digest("hex")}`;
}
