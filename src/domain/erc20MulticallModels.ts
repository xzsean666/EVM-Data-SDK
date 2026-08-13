import { z } from "zod";

import { invalidRequest } from "./errors";

export type Erc20ReadMethod =
  | "balanceOf"
  | "allowance"
  | "decimals"
  | "name"
  | "symbol"
  | "totalSupply";

export type Erc20MulticallCall =
  | { readonly id: string; readonly tokenAddress: string; readonly method: "balanceOf"; readonly owner: string }
  | { readonly id: string; readonly tokenAddress: string; readonly method: "allowance"; readonly owner: string; readonly spender: string }
  | { readonly id: string; readonly tokenAddress: string; readonly method: "decimals" }
  | { readonly id: string; readonly tokenAddress: string; readonly method: "name" }
  | { readonly id: string; readonly tokenAddress: string; readonly method: "symbol" }
  | { readonly id: string; readonly tokenAddress: string; readonly method: "totalSupply" };

export interface Erc20MulticallAtBlockRequest {
  readonly chain: 1 | "ethereum" | 8453 | "base";
  /** Exact block; omitted means the current RPC head. */
  readonly blockNumber?: string;
  readonly calls: readonly Erc20MulticallCall[];
  readonly signal?: AbortSignal;
}

export interface NormalizedErc20MulticallAtBlockRequest {
  readonly chainId: 1 | 8453;
  readonly blockNumber?: string;
  readonly calls: readonly Erc20MulticallCall[];
  readonly signal?: AbortSignal;
}

export interface Erc20MulticallCallResult {
  readonly id: string;
  readonly tokenAddress: string;
  readonly method: Erc20ReadMethod;
  readonly success: boolean;
  /** Decoded value. Quantities are decimal strings; metadata is UTF-8 text. */
  readonly value: string | null;
  /** Stable local reason when the target reverted or returned malformed ABI. */
  readonly error: "CALL_FAILED" | "DECODE_FAILED" | null;
}

export interface Erc20MulticallAtBlockResult {
  readonly chainId: 1 | 8453;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly blockTimestamp: string;
  readonly rpcEndpointId: string;
  readonly multicallBatches: number;
  readonly results: readonly Erc20MulticallCallResult[];
}

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const blockNumberSchema = z.string().max(78).regex(/^[0-9]+$/).transform(canonicalDecimal);
const callBase = { id: z.string().trim().min(1).max(256), tokenAddress: addressSchema.transform((value) => value.toLowerCase()) };
const callSchema = z.discriminatedUnion("method", [
  z.object({ ...callBase, method: z.literal("balanceOf"), owner: addressSchema.transform((value) => value.toLowerCase()) }).strict(),
  z.object({ ...callBase, method: z.literal("allowance"), owner: addressSchema.transform((value) => value.toLowerCase()), spender: addressSchema.transform((value) => value.toLowerCase()) }).strict(),
  z.object({ ...callBase, method: z.literal("decimals") }).strict(),
  z.object({ ...callBase, method: z.literal("name") }).strict(),
  z.object({ ...callBase, method: z.literal("symbol") }).strict(),
  z.object({ ...callBase, method: z.literal("totalSupply") }).strict(),
]);
const requestSchema = z.object({
  chain: z.union([z.literal(1), z.literal("ethereum"), z.literal(8453), z.literal("base")]),
  blockNumber: blockNumberSchema.optional(),
  calls: z.array(callSchema).min(1).max(1000),
  signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
}).strict();

export function parseErc20MulticallAtBlockRequest(input: unknown): NormalizedErc20MulticallAtBlockRequest {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw invalidRequest("Invalid ERC-20 multicall request.");
  const ids = new Set<string>();
  for (const call of parsed.data.calls) {
    if (ids.has(call.id)) throw invalidRequest("ERC-20 multicall calls must have unique ids.");
    ids.add(call.id);
  }
  return {
    chainId: parsed.data.chain === 8453 || parsed.data.chain === "base" ? 8453 : 1,
    ...(parsed.data.blockNumber === undefined ? {} : { blockNumber: parsed.data.blockNumber }),
    calls: Object.freeze(parsed.data.calls.map((call) => Object.freeze(call))),
    ...(parsed.data.signal === undefined ? {} : { signal: parsed.data.signal }),
  };
}

function canonicalDecimal(value: string): string {
  const canonical = value.replace(/^0+(?=\d)/, "");
  return canonical === "" ? "0" : canonical;
}
