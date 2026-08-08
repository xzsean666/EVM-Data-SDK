import { describe, expect, it, vi } from "vitest";

import { ChainlinkService, type ChainlinkMulticallService } from "../../src/chainlink/ChainlinkService";
import type { ChainlinkFeedDefinition } from "../../src/chainlink/ChainlinkFeedDefinition";
import type { MulticallAtBlockCallResult, MulticallAtBlockRequest, MulticallAtBlockResult } from "../../src/domain/rpcModels";

const BLOCK_NUMBER = "18000000";
const BLOCK_HASH = `0x${"ab".repeat(32)}`;
const BLOCK_TIMESTAMP = "1700000060"; // 2023-11-14T22:14:20Z-ish; used only as an opaque anchor.
const RPC_ENDPOINT_ID = "fake-endpoint";

function wordUint(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function wordInt(value: bigint): string {
  const normalized = value < 0n ? value + (1n << 256n) : value;
  return normalized.toString(16).padStart(64, "0");
}

function encodeLatestRoundData(data: {
  readonly roundId: bigint;
  readonly answer: bigint;
  readonly startedAt: bigint;
  readonly updatedAt: bigint;
  readonly answeredInRound: bigint;
}): string {
  return `0x${wordUint(data.roundId)}${wordInt(data.answer)}${wordUint(data.startedAt)}${wordUint(data.updatedAt)}${wordUint(data.answeredInRound)}`;
}

function encodeDecimals(value: number): string {
  return `0x${wordUint(BigInt(value))}`;
}

function makeFeed(overrides: Partial<ChainlinkFeedDefinition> & { readonly id: string }): ChainlinkFeedDefinition {
  return Object.freeze({
    chainId: 1,
    proxyAddress: "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419",
    assetSymbol: "ETH",
    assetName: "Ethereum",
    baseAsset: "ETH",
    quoteAsset: "USD",
    expectedDecimals: 8,
    heartbeatSeconds: "3600",
    sourcePath: "eth-usd",
    ...overrides,
  });
}

function latestRoundDataCallId(feed: ChainlinkFeedDefinition): string {
  return `${feed.id}::latestRoundData`;
}

function decimalsCallId(feed: ChainlinkFeedDefinition): string {
  return `${feed.id}::decimals`;
}

interface FakeCallResult {
  readonly success: boolean;
  readonly returnData: string;
}

function fakeRpcService(
  resultsById: Readonly<Record<string, FakeCallResult>>,
  overrides: Partial<Omit<MulticallAtBlockResult, "results" | "chainId" | "blockNumber">> = {},
): ChainlinkMulticallService & { readonly multicallAtBlock: ReturnType<typeof vi.fn> } {
  return {
    multicallAtBlock: vi.fn((request: MulticallAtBlockRequest): Promise<MulticallAtBlockResult> => {
      const results: MulticallAtBlockCallResult[] = request.calls.map((call) => {
        const fake = resultsById[call.id];
        if (fake === undefined) {
          throw new Error(`Test fixture is missing a fake result for call id "${call.id}".`);
        }
        return Object.freeze({ id: call.id, success: fake.success, returnData: fake.returnData });
      });
      return Promise.resolve(
        Object.freeze({
          chainId: 1,
          blockNumber: BLOCK_NUMBER,
          blockHash: overrides.blockHash ?? BLOCK_HASH,
          blockTimestamp: overrides.blockTimestamp ?? BLOCK_TIMESTAMP,
          rpcEndpointId: overrides.rpcEndpointId ?? RPC_ENDPOINT_ID,
          multicallBatches: overrides.multicallBatches ?? 1,
          results: Object.freeze(results),
        }),
      );
    }),
  };
}

describe("ChainlinkService.getTokenPricesAtBlock", () => {
  it("resolves a positive int256 answer into a canonical fixed-point price", async () => {
    const feed = makeFeed({ id: "ethereum-mainnet:eth-usd", heartbeatSeconds: null });
    const rpcService = fakeRpcService({
      [latestRoundDataCallId(feed)]: {
        success: true,
        returnData: encodeLatestRoundData({
          roundId: 100n,
          answer: 300000000000n,
          startedAt: 1700000000n,
          updatedAt: 1700000060n,
          answeredInRound: 100n,
        }),
      },
      [decimalsCallId(feed)]: { success: true, returnData: encodeDecimals(8) },
    });
    const service = new ChainlinkService({ rpcService, manifest: [feed] });

    const result = await service.getTokenPricesAtBlock({ blockNumber: BLOCK_NUMBER });

    expect(result.failures).toEqual([]);
    expect(result.prices).toHaveLength(1);
    const price = result.prices[0]!;
    expect(price.feedId).toBe(feed.id);
    expect(price.rawAnswer).toBe("300000000000");
    expect(price.price).toBe("3000");
    expect(price.decimals).toBe(8);
    expect(price.roundId).toBe("100");
    expect(price.answeredInRound).toBe("100");
    expect(price.isStale).toBeNull();
    expect(price.provider).toBe("chainlink");
    expect(result.blockHash).toBe(BLOCK_HASH);
    expect(result.blockTimestamp).toBe(BLOCK_TIMESTAMP);
    expect(result.rpcEndpointId).toBe(RPC_ENDPOINT_ID);
    expect(result.executionMode).toBe("multicall3");
    expect(result.summary).toEqual({
      configuredFeeds: 1,
      requestedFeeds: 1,
      succeededFeeds: 1,
      failedFeeds: 0,
      multicallBatches: 1,
      partial: false,
    });
  });

  it("formats a fractional price and trims trailing zeros without floating point", async () => {
    const feed = makeFeed({ id: "ethereum-mainnet:eth-usd", heartbeatSeconds: null });
    const rpcService = fakeRpcService({
      [latestRoundDataCallId(feed)]: {
        success: true,
        returnData: encodeLatestRoundData({
          roundId: 1n,
          answer: 300012345678n,
          startedAt: 1700000000n,
          updatedAt: 1700000000n,
          answeredInRound: 1n,
        }),
      },
      [decimalsCallId(feed)]: { success: true, returnData: encodeDecimals(8) },
    });
    const service = new ChainlinkService({ rpcService, manifest: [feed] });

    const result = await service.getTokenPricesAtBlock({ blockNumber: BLOCK_NUMBER });

    expect(result.prices[0]!.price).toBe("3000.12345678");
  });

  it("rejects a non-positive answer (negative or zero) as FEED_ROUND_UNAVAILABLE", async () => {
    const negativeFeed = makeFeed({ id: "ethereum-mainnet:neg-usd" });
    const zeroFeed = makeFeed({ id: "ethereum-mainnet:zero-usd" });
    const rpcService = fakeRpcService({
      [latestRoundDataCallId(negativeFeed)]: {
        success: true,
        returnData: encodeLatestRoundData({
          roundId: 1n,
          answer: -100n,
          startedAt: 1700000000n,
          updatedAt: 1700000000n,
          answeredInRound: 1n,
        }),
      },
      [decimalsCallId(negativeFeed)]: { success: true, returnData: encodeDecimals(8) },
      [latestRoundDataCallId(zeroFeed)]: {
        success: true,
        returnData: encodeLatestRoundData({
          roundId: 1n,
          answer: 0n,
          startedAt: 1700000000n,
          updatedAt: 1700000000n,
          answeredInRound: 1n,
        }),
      },
      [decimalsCallId(zeroFeed)]: { success: true, returnData: encodeDecimals(8) },
      // Third healthy feed so the request does not reject as all-failure.
      [latestRoundDataCallId(makeFeed({ id: "ethereum-mainnet:ok-usd" }))]: {
        success: true,
        returnData: encodeLatestRoundData({
          roundId: 1n,
          answer: 1n,
          startedAt: 1700000000n,
          updatedAt: 1700000000n,
          answeredInRound: 1n,
        }),
      },
      [decimalsCallId(makeFeed({ id: "ethereum-mainnet:ok-usd" }))]: { success: true, returnData: encodeDecimals(8) },
    });
    const service = new ChainlinkService({
      rpcService,
      manifest: [negativeFeed, zeroFeed, makeFeed({ id: "ethereum-mainnet:ok-usd" })],
    });

    const result = await service.getTokenPricesAtBlock({ blockNumber: BLOCK_NUMBER });

    expect(result.failures).toHaveLength(2);
    expect(result.failures.map((failure) => failure.feedId).sort()).toEqual(
      [negativeFeed.id, zeroFeed.id].sort(),
    );
    for (const failure of result.failures) {
      expect(failure.code).toBe("FEED_ROUND_UNAVAILABLE");
      expect(failure.retryable).toBe(false);
    }
  });

  it("rejects a zero updatedAt timestamp as FEED_ROUND_UNAVAILABLE", async () => {
    const feed = makeFeed({ id: "ethereum-mainnet:eth-usd" });
    const okFeed = makeFeed({ id: "ethereum-mainnet:ok-usd" });
    const rpcService = fakeRpcService({
      [latestRoundDataCallId(feed)]: {
        success: true,
        returnData: encodeLatestRoundData({
          roundId: 1n,
          answer: 100n,
          startedAt: 0n,
          updatedAt: 0n,
          answeredInRound: 1n,
        }),
      },
      [decimalsCallId(feed)]: { success: true, returnData: encodeDecimals(8) },
      [latestRoundDataCallId(okFeed)]: {
        success: true,
        returnData: encodeLatestRoundData({
          roundId: 1n,
          answer: 1n,
          startedAt: 1700000000n,
          updatedAt: 1700000000n,
          answeredInRound: 1n,
        }),
      },
      [decimalsCallId(okFeed)]: { success: true, returnData: encodeDecimals(8) },
    });
    const service = new ChainlinkService({ rpcService, manifest: [feed, okFeed] });

    const result = await service.getTokenPricesAtBlock({ blockNumber: BLOCK_NUMBER });

    expect(result.failures).toEqual([
      expect.objectContaining({ feedId: feed.id, code: "FEED_ROUND_UNAVAILABLE" }),
    ]);
  });

  it("marks a round stale when its age exceeds the committed heartbeat, without omitting the price", async () => {
    const feed = makeFeed({ id: "ethereum-mainnet:eth-usd", heartbeatSeconds: "3600" });
    const rpcService = fakeRpcService(
      {
        [latestRoundDataCallId(feed)]: {
          success: true,
          returnData: encodeLatestRoundData({
            roundId: 1n,
            answer: 100n,
            startedAt: 1699990000n,
            updatedAt: 1699990000n,
            answeredInRound: 1n,
          }),
        },
        [decimalsCallId(feed)]: { success: true, returnData: encodeDecimals(8) },
      },
      { blockTimestamp: "1700000000" }, // age = 10000s > 3600s heartbeat.
    );
    const service = new ChainlinkService({ rpcService, manifest: [feed] });

    const result = await service.getTokenPricesAtBlock({ blockNumber: BLOCK_NUMBER });

    expect(result.prices[0]!.isStale).toBe(true);
    expect(result.prices[0]!.ageSeconds).toBe("10000");
  });

  it("marks a round fresh when its age is within the committed heartbeat", async () => {
    const feed = makeFeed({ id: "ethereum-mainnet:eth-usd", heartbeatSeconds: "3600" });
    const rpcService = fakeRpcService(
      {
        [latestRoundDataCallId(feed)]: {
          success: true,
          returnData: encodeLatestRoundData({
            roundId: 1n,
            answer: 100n,
            startedAt: 1699999000n,
            updatedAt: 1699999000n,
            answeredInRound: 1n,
          }),
        },
        [decimalsCallId(feed)]: { success: true, returnData: encodeDecimals(8) },
      },
      { blockTimestamp: "1700000000" }, // age = 1000s <= 3600s heartbeat.
    );
    const service = new ChainlinkService({ rpcService, manifest: [feed] });

    const result = await service.getTokenPricesAtBlock({ blockNumber: BLOCK_NUMBER });

    expect(result.prices[0]!.isStale).toBe(false);
  });

  it("fails a feed whose runtime decimals() differs from the committed manifest as FEED_RESPONSE_INVALID", async () => {
    const feed = makeFeed({ id: "ethereum-mainnet:eth-usd", expectedDecimals: 8 });
    const okFeed = makeFeed({ id: "ethereum-mainnet:ok-usd" });
    const rpcService = fakeRpcService({
      [latestRoundDataCallId(feed)]: {
        success: true,
        returnData: encodeLatestRoundData({
          roundId: 1n,
          answer: 100n,
          startedAt: 1699999000n,
          updatedAt: 1699999000n,
          answeredInRound: 1n,
        }),
      },
      [decimalsCallId(feed)]: { success: true, returnData: encodeDecimals(18) },
      [latestRoundDataCallId(okFeed)]: {
        success: true,
        returnData: encodeLatestRoundData({
          roundId: 1n,
          answer: 1n,
          startedAt: 1700000000n,
          updatedAt: 1700000000n,
          answeredInRound: 1n,
        }),
      },
      [decimalsCallId(okFeed)]: { success: true, returnData: encodeDecimals(8) },
    });
    const service = new ChainlinkService({ rpcService, manifest: [feed, okFeed] });

    const result = await service.getTokenPricesAtBlock({ blockNumber: BLOCK_NUMBER });

    expect(result.failures).toEqual([
      expect.objectContaining({ feedId: feed.id, code: "FEED_RESPONSE_INVALID" }),
    ]);
  });

  it("fails a feed whose latestRoundData() call reverted as FEED_CALL_REVERTED", async () => {
    const feed = makeFeed({ id: "ethereum-mainnet:eth-usd" });
    const okFeed = makeFeed({ id: "ethereum-mainnet:ok-usd" });
    const rpcService = fakeRpcService({
      [latestRoundDataCallId(feed)]: { success: false, returnData: "0x08c379a0" },
      [decimalsCallId(feed)]: { success: true, returnData: encodeDecimals(8) },
      [latestRoundDataCallId(okFeed)]: {
        success: true,
        returnData: encodeLatestRoundData({
          roundId: 1n,
          answer: 1n,
          startedAt: 1700000000n,
          updatedAt: 1700000000n,
          answeredInRound: 1n,
        }),
      },
      [decimalsCallId(okFeed)]: { success: true, returnData: encodeDecimals(8) },
    });
    const service = new ChainlinkService({ rpcService, manifest: [feed, okFeed] });

    const result = await service.getTokenPricesAtBlock({ blockNumber: BLOCK_NUMBER });

    expect(result.failures).toEqual([
      expect.objectContaining({ feedId: feed.id, code: "FEED_CALL_REVERTED" }),
    ]);
  });

  it("fails a feed with no deployed code at this block (empty return data) as FEED_NOT_DEPLOYED_AT_BLOCK", async () => {
    const feed = makeFeed({ id: "ethereum-mainnet:eth-usd" });
    const okFeed = makeFeed({ id: "ethereum-mainnet:ok-usd" });
    const rpcService = fakeRpcService({
      [latestRoundDataCallId(feed)]: { success: true, returnData: "0x" },
      [decimalsCallId(feed)]: { success: true, returnData: encodeDecimals(8) },
      [latestRoundDataCallId(okFeed)]: {
        success: true,
        returnData: encodeLatestRoundData({
          roundId: 1n,
          answer: 1n,
          startedAt: 1700000000n,
          updatedAt: 1700000000n,
          answeredInRound: 1n,
        }),
      },
      [decimalsCallId(okFeed)]: { success: true, returnData: encodeDecimals(8) },
    });
    const service = new ChainlinkService({ rpcService, manifest: [feed, okFeed] });

    const result = await service.getTokenPricesAtBlock({ blockNumber: BLOCK_NUMBER });

    expect(result.failures).toEqual([
      expect.objectContaining({ feedId: feed.id, code: "FEED_NOT_DEPLOYED_AT_BLOCK" }),
    ]);
  });

  it("fails a feed with a malformed (truncated) latestRoundData tuple as FEED_RESPONSE_INVALID", async () => {
    const feed = makeFeed({ id: "ethereum-mainnet:eth-usd" });
    const okFeed = makeFeed({ id: "ethereum-mainnet:ok-usd" });
    const rpcService = fakeRpcService({
      [latestRoundDataCallId(feed)]: { success: true, returnData: `0x${wordUint(1n)}` },
      [decimalsCallId(feed)]: { success: true, returnData: encodeDecimals(8) },
      [latestRoundDataCallId(okFeed)]: {
        success: true,
        returnData: encodeLatestRoundData({
          roundId: 1n,
          answer: 1n,
          startedAt: 1700000000n,
          updatedAt: 1700000000n,
          answeredInRound: 1n,
        }),
      },
      [decimalsCallId(okFeed)]: { success: true, returnData: encodeDecimals(8) },
    });
    const service = new ChainlinkService({ rpcService, manifest: [feed, okFeed] });

    const result = await service.getTokenPricesAtBlock({ blockNumber: BLOCK_NUMBER });

    expect(result.failures).toEqual([
      expect.objectContaining({ feedId: feed.id, code: "FEED_RESPONSE_INVALID" }),
    ]);
  });

  it("fails a feed whose answeredInRound is less than its own roundId as FEED_ANSWER_INVALID", async () => {
    const feed = makeFeed({ id: "ethereum-mainnet:eth-usd" });
    const okFeed = makeFeed({ id: "ethereum-mainnet:ok-usd" });
    const rpcService = fakeRpcService({
      [latestRoundDataCallId(feed)]: {
        success: true,
        returnData: encodeLatestRoundData({
          roundId: 10n,
          answer: 100n,
          startedAt: 1700000000n,
          updatedAt: 1700000000n,
          answeredInRound: 5n,
        }),
      },
      [decimalsCallId(feed)]: { success: true, returnData: encodeDecimals(8) },
      [latestRoundDataCallId(okFeed)]: {
        success: true,
        returnData: encodeLatestRoundData({
          roundId: 1n,
          answer: 1n,
          startedAt: 1700000000n,
          updatedAt: 1700000000n,
          answeredInRound: 1n,
        }),
      },
      [decimalsCallId(okFeed)]: { success: true, returnData: encodeDecimals(8) },
    });
    const service = new ChainlinkService({ rpcService, manifest: [feed, okFeed] });

    const result = await service.getTokenPricesAtBlock({ blockNumber: BLOCK_NUMBER });

    expect(result.failures).toEqual([
      expect.objectContaining({ feedId: feed.id, code: "FEED_ANSWER_INVALID" }),
    ]);
  });

  it("fails a feed whose updatedAt is after the block timestamp as FEED_ANSWER_INVALID", async () => {
    const feed = makeFeed({ id: "ethereum-mainnet:eth-usd" });
    const okFeed = makeFeed({ id: "ethereum-mainnet:ok-usd" });
    const rpcService = fakeRpcService(
      {
        [latestRoundDataCallId(feed)]: {
          success: true,
          returnData: encodeLatestRoundData({
            roundId: 1n,
            answer: 100n,
            startedAt: 1700000500n,
            updatedAt: 1700000500n,
            answeredInRound: 1n,
          }),
        },
        [decimalsCallId(feed)]: { success: true, returnData: encodeDecimals(8) },
        [latestRoundDataCallId(okFeed)]: {
          success: true,
          returnData: encodeLatestRoundData({
            roundId: 1n,
            answer: 1n,
            startedAt: 1700000000n,
            updatedAt: 1700000000n,
            answeredInRound: 1n,
          }),
        },
        [decimalsCallId(okFeed)]: { success: true, returnData: encodeDecimals(8) },
      },
      { blockTimestamp: "1700000000" },
    );
    const service = new ChainlinkService({ rpcService, manifest: [feed, okFeed] });

    const result = await service.getTokenPricesAtBlock({ blockNumber: BLOCK_NUMBER });

    expect(result.failures).toEqual([
      expect.objectContaining({ feedId: feed.id, code: "FEED_ANSWER_INVALID" }),
    ]);
  });

  it("returns a partial result when some feeds succeed and others fail", async () => {
    const goodFeed = makeFeed({ id: "ethereum-mainnet:good-usd" });
    const badFeed = makeFeed({ id: "ethereum-mainnet:bad-usd" });
    const rpcService = fakeRpcService({
      [latestRoundDataCallId(goodFeed)]: {
        success: true,
        returnData: encodeLatestRoundData({
          roundId: 1n,
          answer: 100n,
          startedAt: 1700000000n,
          updatedAt: 1700000000n,
          answeredInRound: 1n,
        }),
      },
      [decimalsCallId(goodFeed)]: { success: true, returnData: encodeDecimals(8) },
      [latestRoundDataCallId(badFeed)]: { success: false, returnData: "0x08c379a0" },
      [decimalsCallId(badFeed)]: { success: true, returnData: encodeDecimals(8) },
    });
    const service = new ChainlinkService({ rpcService, manifest: [goodFeed, badFeed] });

    const result = await service.getTokenPricesAtBlock({ blockNumber: BLOCK_NUMBER });

    expect(result.prices).toHaveLength(1);
    expect(result.failures).toHaveLength(1);
    expect(result.summary).toEqual({
      configuredFeeds: 2,
      requestedFeeds: 2,
      succeededFeeds: 1,
      failedFeeds: 1,
      multicallBatches: 1,
      partial: true,
    });
  });

  it("rejects with CHAINLINK_PRICE_DATA_UNAVAILABLE when every feed fails", async () => {
    const feedA = makeFeed({ id: "ethereum-mainnet:a-usd" });
    const feedB = makeFeed({ id: "ethereum-mainnet:b-usd" });
    const rpcService = fakeRpcService({
      [latestRoundDataCallId(feedA)]: { success: false, returnData: "0x08c379a0" },
      [decimalsCallId(feedA)]: { success: true, returnData: encodeDecimals(8) },
      [latestRoundDataCallId(feedB)]: { success: true, returnData: "0x" },
      [decimalsCallId(feedB)]: { success: true, returnData: encodeDecimals(8) },
    });
    const service = new ChainlinkService({ rpcService, manifest: [feedA, feedB] });

    await expect(service.getTokenPricesAtBlock({ blockNumber: BLOCK_NUMBER })).rejects.toMatchObject({
      code: "CHAINLINK_PRICE_DATA_UNAVAILABLE",
    });
  });

  it("rejects an invalid request before ever calling the injected rpc service", async () => {
    const feed = makeFeed({ id: "ethereum-mainnet:eth-usd" });
    const rpcService = fakeRpcService({});
    const service = new ChainlinkService({ rpcService, manifest: [feed] });

    await expect(service.getTokenPricesAtBlock({ blockNumber: "-1" })).rejects.toMatchObject({
      code: "INVALID_REQUEST",
    });
    expect(rpcService.multicallAtBlock).not.toHaveBeenCalled();
  });

  it("computes a stable registryVersion for the same manifest and issues both calls with allowFailure", async () => {
    const feed = makeFeed({ id: "ethereum-mainnet:eth-usd" });
    const rpcService = fakeRpcService({
      [latestRoundDataCallId(feed)]: {
        success: true,
        returnData: encodeLatestRoundData({
          roundId: 1n,
          answer: 100n,
          startedAt: 1700000000n,
          updatedAt: 1700000000n,
          answeredInRound: 1n,
        }),
      },
      [decimalsCallId(feed)]: { success: true, returnData: encodeDecimals(8) },
    });
    const serviceA = new ChainlinkService({ rpcService, manifest: [feed] });
    const serviceB = new ChainlinkService({ rpcService, manifest: [feed] });

    const resultA = await serviceA.getTokenPricesAtBlock({ blockNumber: BLOCK_NUMBER });
    const resultB = await serviceB.getTokenPricesAtBlock({ blockNumber: BLOCK_NUMBER });

    expect(resultA.registryVersion).toBe(resultB.registryVersion);
    expect(resultA.registryVersion).toMatch(/^sha256:[0-9a-f]{64}$/);

    const callArgs = rpcService.multicallAtBlock.mock.calls[0]![0] as MulticallAtBlockRequest;
    expect(callArgs.calls.every((call) => call.allowFailure === true)).toBe(true);
    expect(callArgs.calls).toHaveLength(2);
  });
});
