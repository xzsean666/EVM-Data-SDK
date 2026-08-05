import { z } from "zod";

import type { ChainReference } from "./chains";
import { invalidRequest } from "./errors";
import { MAX_CURSOR_LENGTH } from "./pagination";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 100;
export const OPERATION_NAMES = [
  "getTransactions",
  "getNativeBalance",
  "getErc20Transfers",
  "getPriceHistory",
] as const;

export type OperationName = (typeof OPERATION_NAMES)[number];
export type SortOrder = "asc" | "desc";
export type TransferDirection = "incoming" | "outgoing" | "both";

export interface TransactionsRequest {
  readonly chain: ChainReference;
  readonly address: string;
  readonly pageSize?: number;
  readonly order?: SortOrder;
  readonly startBlock?: string;
  readonly endBlock?: string;
  readonly cursor?: string;
  readonly signal?: AbortSignal;
}

export interface NativeBalanceRequest {
  readonly chain: ChainReference;
  readonly address: string;
  readonly signal?: AbortSignal;
}

export interface Erc20TransfersRequest {
  readonly chain: ChainReference;
  readonly address: string;
  readonly tokenAddress?: string;
  readonly direction?: TransferDirection;
  readonly pageSize?: number;
  readonly order?: SortOrder;
  readonly startBlock?: string;
  readonly endBlock?: string;
  readonly cursor?: string;
  readonly signal?: AbortSignal;
}

export interface NormalizedTransactionsRequest {
  readonly operation: "getTransactions";
  readonly chain: ChainReference;
  readonly address: string;
  readonly pageSize: number;
  readonly order: SortOrder;
  readonly startBlock: string | null;
  readonly endBlock: string | null;
  readonly cursor: string | null;
  readonly signal?: AbortSignal;
}

export interface NormalizedNativeBalanceRequest {
  readonly operation: "getNativeBalance";
  readonly chain: ChainReference;
  readonly address: string;
  readonly signal?: AbortSignal;
}

export interface NormalizedErc20TransfersRequest {
  readonly operation: "getErc20Transfers";
  readonly chain: ChainReference;
  readonly address: string;
  readonly tokenAddress: string | null;
  readonly direction: TransferDirection;
  readonly pageSize: number;
  readonly order: SortOrder;
  readonly startBlock: string | null;
  readonly endBlock: string | null;
  readonly cursor: string | null;
  readonly signal?: AbortSignal;
}

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const chainReferenceSchema = z.union([
  z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  z.string().trim().min(1).max(128),
]);
const decimalQuantitySchema = z
  .string()
  .max(78)
  .regex(/^[0-9]+$/)
  .transform((value) => canonicalDecimal(value));
const cursorSchema = z.string().min(1).max(MAX_CURSOR_LENGTH);
const pageSizeSchema = z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE);
const orderSchema = z.enum(["asc", "desc"]).default("desc");
const directionSchema = z.enum(["incoming", "outgoing", "both"]).default("both");

const transactionsRequestSchema = z
  .object({
    chain: chainReferenceSchema,
    address: addressSchema.transform((value) => value.toLowerCase()),
    pageSize: pageSizeSchema,
    order: orderSchema,
    startBlock: decimalQuantitySchema.optional(),
    endBlock: decimalQuantitySchema.optional(),
    cursor: cursorSchema.optional(),
    signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
  })
  .strict();

const nativeBalanceRequestSchema = z
  .object({
    chain: chainReferenceSchema,
    address: addressSchema.transform((value) => value.toLowerCase()),
    signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
  })
  .strict();

const erc20TransfersRequestSchema = z
  .object({
    chain: chainReferenceSchema,
    address: addressSchema.transform((value) => value.toLowerCase()),
    tokenAddress: addressSchema
      .transform((value) => value.toLowerCase())
      .optional(),
    direction: directionSchema,
    pageSize: pageSizeSchema,
    order: orderSchema,
    startBlock: decimalQuantitySchema.optional(),
    endBlock: decimalQuantitySchema.optional(),
    cursor: cursorSchema.optional(),
    signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
  })
  .strict();

export function parseTransactionsRequest(input: unknown): NormalizedTransactionsRequest {
  const parsed = parseSchema(transactionsRequestSchema, input, "transactions request");
  validateBlockRange(parsed.startBlock, parsed.endBlock);
  return {
    operation: "getTransactions",
    chain: normalizeChainReference(parsed.chain),
    address: parsed.address,
    pageSize: parsed.pageSize,
    order: parsed.order,
    startBlock: parsed.startBlock ?? null,
    endBlock: parsed.endBlock ?? null,
    cursor: parsed.cursor ?? null,
    ...(parsed.signal === undefined ? {} : { signal: parsed.signal }),
  };
}

export function parseNativeBalanceRequest(input: unknown): NormalizedNativeBalanceRequest {
  const parsed = parseSchema(nativeBalanceRequestSchema, input, "native balance request");
  return {
    operation: "getNativeBalance",
    chain: normalizeChainReference(parsed.chain),
    address: parsed.address,
    ...(parsed.signal === undefined ? {} : { signal: parsed.signal }),
  };
}

export function parseErc20TransfersRequest(input: unknown): NormalizedErc20TransfersRequest {
  const parsed = parseSchema(erc20TransfersRequestSchema, input, "ERC-20 transfers request");
  validateBlockRange(parsed.startBlock, parsed.endBlock);
  return {
    operation: "getErc20Transfers",
    chain: normalizeChainReference(parsed.chain),
    address: parsed.address,
    tokenAddress: parsed.tokenAddress ?? null,
    direction: parsed.direction,
    pageSize: parsed.pageSize,
    order: parsed.order,
    startBlock: parsed.startBlock ?? null,
    endBlock: parsed.endBlock ?? null,
    cursor: parsed.cursor ?? null,
    ...(parsed.signal === undefined ? {} : { signal: parsed.signal }),
  };
}

export const normalizeTransactionsRequest = parseTransactionsRequest;
export const normalizeNativeBalanceRequest = parseNativeBalanceRequest;
export const normalizeErc20TransfersRequest = parseErc20TransfersRequest;

export function normalizeChainReference(value: ChainReference): ChainReference {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw invalidRequest("Chain ID must be a positive safe integer.");
    }
    return value;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) {
    throw invalidRequest("Chain reference must not be empty.");
  }
  return normalized;
}

function parseSchema<T extends z.ZodType>(schema: T, input: unknown, label: string): z.output<T> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw invalidRequest(`Invalid ${label}.`);
  }
  return parsed.data;
}

function validateBlockRange(startBlock: string | undefined, endBlock: string | undefined): void {
  if (startBlock !== undefined && endBlock !== undefined && BigInt(startBlock) > BigInt(endBlock)) {
    throw invalidRequest("startBlock must not be greater than endBlock.");
  }
}

function canonicalDecimal(value: string): string {
  const canonical = value.replace(/^0+(?=\d)/, "");
  return canonical === "" ? "0" : canonical;
}
