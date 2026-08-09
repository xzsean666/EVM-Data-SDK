import { z } from "zod";

import { invalidRequest } from "./errors";

/**
 * `client.chainlink.getTokenPricesAtBlock()` request/result contracts. This
 * is a Chainlink oracle-state read, not a market candle, trade price, TWAP,
 * or cross-provider consensus price. It always evaluates every enabled
 * built-in feed; there is no token selector.
 */
export interface ChainlinkTokenPricesAtBlockRequest {
  /** Canonical non-negative base-10 Ethereum Mainnet block number. */
  readonly blockNumber: string;
  readonly signal?: AbortSignal;
}

export interface NormalizedChainlinkTokenPricesAtBlockRequest {
  readonly blockNumber: string;
  readonly signal?: AbortSignal;
}

export interface ChainlinkPriceAtBlock {
  readonly feedId: string;
  /** Canonical symbol of the asset priced by this feed (for example `DAI`). */
  readonly tokenSymbol: string;
  readonly asset: {
    readonly symbol: string;
    readonly name: string | null;
  };
  readonly pair: {
    readonly base: string;
    readonly quote: "USD";
  };
  readonly feedAddress: string;
  readonly blockNumber: string;
  /** Exact signed answer converted to a canonical base-10 integer string. */
  readonly rawAnswer: string;
  /** Exact fixed-point decimal string derived from rawAnswer and decimals. */
  readonly price: string;
  readonly decimals: number;
  readonly roundId: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly answeredInRound: string;
  readonly ageSeconds: string;
  readonly heartbeatSeconds: string | null;
  readonly isStale: boolean | null;
  readonly provider: "chainlink";
}

export type ChainlinkFeedFailureCode =
  | "FEED_NOT_DEPLOYED_AT_BLOCK"
  | "FEED_CALL_REVERTED"
  | "FEED_ROUND_UNAVAILABLE"
  | "FEED_ANSWER_INVALID"
  | "FEED_RESPONSE_INVALID";

export interface ChainlinkFeedFailure {
  readonly feedId: string;
  readonly assetSymbol: string;
  readonly feedAddress: string;
  readonly code: ChainlinkFeedFailureCode;
  readonly retryable: false;
  readonly message: string;
}

export interface ChainlinkTokenPricesAtBlockResult {
  readonly chainId: 1;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly blockTimestamp: string;
  readonly registryVersion: string;
  /** Stable configured ID only; never the selected endpoint URL. */
  readonly rpcEndpointId: string;
  readonly executionMode: "multicall3";
  readonly prices: readonly ChainlinkPriceAtBlock[];
  readonly failures: readonly ChainlinkFeedFailure[];
  readonly summary: {
    readonly configuredFeeds: number;
    readonly requestedFeeds: number;
    readonly succeededFeeds: number;
    readonly failedFeeds: number;
    readonly multicallBatches: number;
    readonly partial: boolean;
  };
}

const blockNumberSchema = z
  .string()
  .max(78)
  .regex(/^[0-9]+$/)
  .transform((value) => canonicalDecimal(value));

const chainlinkTokenPricesAtBlockRequestSchema = z
  .object({
    blockNumber: blockNumberSchema,
    signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
  })
  .strict();

export function parseChainlinkTokenPricesAtBlockRequest(
  input: unknown,
): NormalizedChainlinkTokenPricesAtBlockRequest {
  const parsed = chainlinkTokenPricesAtBlockRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidRequest("Invalid Chainlink getTokenPricesAtBlock request.");
  }
  return {
    blockNumber: parsed.data.blockNumber,
    ...(parsed.data.signal === undefined ? {} : { signal: parsed.data.signal }),
  };
}

function canonicalDecimal(value: string): string {
  const canonical = value.replace(/^0+(?=\d)/, "");
  return canonical === "" ? "0" : canonical;
}
