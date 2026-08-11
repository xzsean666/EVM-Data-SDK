import { z } from "zod";

import { invalidRequest } from "./errors";

/**
 * Provider-neutral, read-only Multicall3 `aggregate3` call description. This
 * module owns call validation, deterministic batching, and result mapping;
 * it has no Chainlink-specific knowledge.
 */
export interface MulticallAtBlockCall {
  readonly id: string;
  readonly target: string;
  readonly callData: string;
  readonly allowFailure?: boolean;
}

export interface MulticallAtBlockRequest {
  readonly chain: 1 | "ethereum" | 8453 | "base";
  readonly blockNumber: string;
  readonly calls: readonly MulticallAtBlockCall[];
  readonly signal?: AbortSignal;
}

export interface NormalizedMulticallAtBlockCall {
  readonly id: string;
  readonly target: string;
  readonly callData: string;
  readonly allowFailure: boolean;
}

export interface NormalizedMulticallAtBlockRequest {
  readonly chainId: 1 | 8453;
  readonly blockNumber: string;
  readonly calls: readonly NormalizedMulticallAtBlockCall[];
  readonly signal?: AbortSignal;
}

export interface MulticallAtBlockCallResult {
  readonly id: string;
  readonly success: boolean;
  readonly returnData: string;
}

export interface MulticallAtBlockResult {
  readonly chainId: 1 | 8453;
  readonly blockNumber: string;
  readonly blockHash: string;
  /** Canonical non-negative base-10 Unix timestamp of `blockHash`. */
  readonly blockTimestamp: string;
  /** Stable configured endpoint ID only; never the endpoint URL. */
  readonly rpcEndpointId: string;
  /** Number of `aggregate3` batches the request was split into. */
  readonly multicallBatches: number;
  readonly results: readonly MulticallAtBlockCallResult[];
}

/** One exact native-currency balance read at a canonical historical block. */
export interface NativeBalanceAtBlockRequest {
  readonly chain: 1 | "ethereum" | 8453 | "base";
  readonly address: string;
  readonly blockNumber: string;
  readonly signal?: AbortSignal;
}

export interface NormalizedNativeBalanceAtBlockRequest {
  readonly chainId: 1 | 8453;
  readonly address: string;
  readonly blockNumber: string;
  readonly signal?: AbortSignal;
}

export interface NativeBalanceAtBlockResult {
  readonly chainId: 1 | 8453;
  readonly address: string;
  readonly blockNumber: string;
  /** Raw native-currency quantity in wei. */
  readonly amount: string;
  readonly blockHash: string;
  /** Canonical non-negative base-10 Unix timestamp of `blockHash`. */
  readonly blockTimestamp: string;
  readonly provider: "archive-rpc";
  /** Stable configured endpoint ID only; never the endpoint URL. */
  readonly rpcEndpointId: string;
}

export const MAX_MULTICALL_CALLS_PER_REQUEST = 1000;

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const callDataSchema = z
  .string()
  .regex(/^0x([0-9a-fA-F]{2})*$/)
  .max(1_000_000);
const callIdSchema = z.string().trim().min(1).max(256);
const blockNumberSchema = z
  .string()
  .max(78)
  .regex(/^[0-9]+$/)
  .transform((value) => canonicalDecimal(value));
const chainSchema = z.union([
  z.literal(1),
  z.literal("ethereum"),
  z.literal(8453),
  z.literal("base"),
]);

const multicallCallSchema = z
  .object({
    id: callIdSchema,
    target: addressSchema.transform((value) => value.toLowerCase()),
    callData: callDataSchema.transform((value) => value.toLowerCase()),
    allowFailure: z.boolean().optional().default(true),
  })
  .strict();

const multicallAtBlockRequestSchema = z
  .object({
    chain: chainSchema,
    blockNumber: blockNumberSchema,
    calls: z.array(multicallCallSchema).min(1).max(MAX_MULTICALL_CALLS_PER_REQUEST),
    signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
  })
  .strict();

const nativeBalanceAtBlockRequestSchema = z
  .object({
    chain: chainSchema,
    address: addressSchema.transform((value) => value.toLowerCase()),
    blockNumber: blockNumberSchema,
    signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
  })
  .strict();

export function parseMulticallAtBlockRequest(input: unknown): NormalizedMulticallAtBlockRequest {
  const parsed = multicallAtBlockRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidRequest("Invalid multicallAtBlock request.");
  }

  const seenIds = new Set<string>();
  const calls = parsed.data.calls.map((call) => {
    if (seenIds.has(call.id)) {
      throw invalidRequest("multicallAtBlock calls must have unique ids.");
    }
    seenIds.add(call.id);
    return Object.freeze({
      id: call.id,
      target: call.target,
      callData: call.callData,
      allowFailure: call.allowFailure,
    });
  });

  return {
    chainId: parsed.data.chain === 8453 || parsed.data.chain === "base" ? 8453 : 1,
    blockNumber: parsed.data.blockNumber,
    calls: Object.freeze(calls),
    ...(parsed.data.signal === undefined ? {} : { signal: parsed.data.signal }),
  };
}

export function parseNativeBalanceAtBlockRequest(
  input: unknown,
): NormalizedNativeBalanceAtBlockRequest {
  const parsed = nativeBalanceAtBlockRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidRequest("Invalid nativeBalanceAtBlock request.");
  }
  return {
    chainId: parsed.data.chain === 8453 || parsed.data.chain === "base" ? 8453 : 1,
    address: parsed.data.address,
    blockNumber: parsed.data.blockNumber,
    ...(parsed.data.signal === undefined ? {} : { signal: parsed.data.signal }),
  };
}

function canonicalDecimal(value: string): string {
  const canonical = value.replace(/^0+(?=\d)/, "");
  return canonical === "" ? "0" : canonical;
}
