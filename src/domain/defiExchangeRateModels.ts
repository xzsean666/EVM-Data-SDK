import { z } from "zod";

import { invalidRequest } from "./errors";

export type DeFiChainReference = 1 | 8453 | "ethereum" | "base";
export type DeFiTokenKind = "lst" | "lending" | "vault" | "lp";
export type DeFiExchangeRateFailureCode = "CALL_REVERTED" | "NOT_DEPLOYED_AT_BLOCK" | "RESPONSE_INVALID" | "ADAPTER_INVALID";

export interface DeFiExchangeRateSnapshotRequest {
  readonly chain: DeFiChainReference;
  readonly blockNumber: string;
  readonly tokenIds?: readonly string[];
  readonly signal?: AbortSignal;
}

export interface NormalizedDeFiExchangeRateSnapshotRequest {
  readonly chainId: 1 | 8453;
  readonly blockNumber: string;
  readonly tokenIds: readonly string[] | null;
  readonly signal?: AbortSignal;
}

export interface DeFiUnderlyingRate {
  readonly address: string | null;
  readonly symbol: string;
  readonly decimals: number;
  readonly isNative: boolean;
  readonly amount: string;
}

export interface DeFiExchangeRate {
  readonly tokenId: string;
  readonly tokenAddress: string;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly kind: DeFiTokenKind;
  readonly protocol: string;
  readonly underlyings: readonly DeFiUnderlyingRate[];
}

export interface DeFiExchangeRateFailure {
  readonly tokenId: string;
  readonly tokenAddress: string;
  readonly code: DeFiExchangeRateFailureCode;
  readonly retryable: false;
  readonly message: string;
}

export interface DeFiExchangeRateSnapshot {
  readonly chainId: 1 | 8453;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly blockTimestamp: string;
  readonly registryVersion: string;
  readonly rpcEndpointId: string;
  readonly executionMode: "multicall3";
  readonly rates: readonly DeFiExchangeRate[];
  readonly failures: readonly DeFiExchangeRateFailure[];
  readonly summary: {
    readonly configuredTokens: number;
    readonly requestedTokens: number;
    readonly succeededTokens: number;
    readonly failedTokens: number;
    readonly multicallBatches: number;
    readonly partial: boolean;
  };
}

const requestSchema = z.object({
  chain: z.union([z.literal(1), z.literal(8453), z.literal("ethereum"), z.literal("base")]),
  blockNumber: z.string().max(78).regex(/^[0-9]+$/).transform(canonicalDecimal),
  tokenIds: z.array(z.string().trim().min(1).max(256)).min(1).max(512).optional(),
  signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
}).strict();

export function parseDeFiExchangeRateSnapshotRequest(input: unknown): NormalizedDeFiExchangeRateSnapshotRequest {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw invalidRequest("Invalid DeFi exchange-rate snapshot request.");
  const tokenIds = parsed.data.tokenIds === undefined ? null : [...new Set(parsed.data.tokenIds)];
  if (parsed.data.tokenIds !== undefined && tokenIds !== null && tokenIds.length !== parsed.data.tokenIds.length) {
    throw invalidRequest("DeFi tokenIds must be unique.");
  }
  return Object.freeze({
    chainId: parsed.data.chain === "base" || parsed.data.chain === 8453 ? 8453 : 1,
    blockNumber: parsed.data.blockNumber,
    tokenIds: tokenIds === null ? null : Object.freeze(tokenIds),
    ...(parsed.data.signal === undefined ? {} : { signal: parsed.data.signal }),
  });
}

function canonicalDecimal(value: string): string {
  const normalized = value.replace(/^0+(?=\d)/, "");
  return normalized === "" ? "0" : normalized;
}
