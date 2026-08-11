import { z } from "zod";

import type { ChainReference } from "./chains";
import type {
  BeaconWithdrawalBlockRangeWindow,
  Erc20BlockRangeWindow,
  InternalNativeTransferBlockRangeWindow,
  TransactionBlockRangeWindow,
} from "./models";
import { invalidBlockRange, invalidRequest } from "./errors";
import { MAX_CURSOR_LENGTH } from "./pagination";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 10_000;
export const OPERATION_NAMES = [
  "getTransactions",
  "getNativeBalance",
  "getErc20Transfers",
  "getErc20TransfersByBlockRange",
  "getInternalNativeTransfersByBlockRange",
  "getPriceHistory",
] as const;

export type OperationName = (typeof OPERATION_NAMES)[number];
export type SortOrder = "asc" | "desc";
export type TransferDirection = "incoming" | "outgoing" | "both";

export interface TransactionsRequest {
  readonly chain: ChainReference;
  readonly address: string;
  readonly pageSize?: number;
  readonly fullData?: boolean;
  readonly order?: SortOrder;
  readonly startBlock?: string;
  readonly endBlock?: string;
  readonly cursor?: string;
  readonly signal?: AbortSignal;
}

export interface TransactionsBlockRangeRequest extends Omit<TransactionsRequest, 'startBlock' | 'endBlock' | 'cursor' | 'pageSize' | 'fullData'> {
  readonly startBlock: string;
  readonly endBlock: string;
  /**
   * Called only for a complete, closed window. When supplied, the SDK does
   * not retain completed transaction items in the final aggregate result.
   */
  readonly onWindow?: (window: TransactionBlockRangeWindow) => void | Promise<void>;
}

/** Complete indexed internal-native transfers in one inclusive block range. */
export interface InternalNativeTransfersBlockRangeRequest extends Omit<TransactionsRequest, 'startBlock' | 'endBlock' | 'cursor' | 'pageSize' | 'fullData'> {
  readonly startBlock: string;
  readonly endBlock: string;
  readonly onWindow?: (window: InternalNativeTransferBlockRangeWindow) => void | Promise<void>;
}

/** Complete EIP-4895 withdrawals in one inclusive block range. */
export interface BeaconWithdrawalsBlockRangeRequest extends Omit<TransactionsRequest, 'startBlock' | 'endBlock' | 'cursor' | 'pageSize' | 'fullData'> {
  readonly startBlock: string;
  readonly endBlock: string;
  readonly onWindow?: (window: BeaconWithdrawalBlockRangeWindow) => void | Promise<void>;
}

export interface NativeBalanceRequest {
  readonly chain: ChainReference;
  readonly address: string;
  readonly signal?: AbortSignal;
}

/** Complete receipt/log context for a bounded explicit transaction-hash set. */
export interface TransactionContextsByHashRequest {
  readonly chain: ChainReference;
  readonly transactionHashes: readonly string[];
  readonly signal?: AbortSignal;
}

export interface NormalizedTransactionContextsByHashRequest {
  readonly chain: ChainReference;
  readonly transactionHashes: readonly string[];
  readonly signal?: AbortSignal;
}

export interface Erc20TransfersRequest {
  readonly chain: ChainReference;
  readonly address: string;
  readonly tokenAddress?: string;
  readonly direction?: TransferDirection;
  readonly pageSize?: number;
  readonly fullData?: boolean;
  readonly order?: SortOrder;
  readonly startBlock?: string;
  readonly endBlock?: string;
  readonly cursor?: string;
  readonly signal?: AbortSignal;
}

/**
 * Reads all address-scoped ERC-20 transfers in one inclusive block interval.
 * This operation deliberately has no page-size or cursor controls.
 */
export interface Erc20BlockRangeRequest {
  readonly chain: ChainReference;
  readonly address: string;
  readonly startBlock: string;
  readonly endBlock: string;
  readonly tokenAddress?: string;
  readonly direction?: TransferDirection;
  readonly signal?: AbortSignal;
  /**
   * Called only for a complete, closed window. When supplied, the SDK does
   * not retain completed transfer items in the final aggregate result.
   */
  readonly onWindow?: (window: Erc20BlockRangeWindow) => void | Promise<void>;
}

/**
 * Historical balances for an explicit contract set. `tokenAddresses` is
 * caller-owned discovery input; it is not a request to enumerate a wallet.
 */
export interface Erc20BalancesAtBlockRequest {
  readonly chain: ChainReference;
  readonly address: string;
  readonly blockNumber: string;
  readonly tokenAddresses: readonly string[];
  readonly signal?: AbortSignal;
}

export interface Erc20TokenHoldingsRequest {
  readonly chain: ChainReference;
  readonly address: string;
  readonly signal?: AbortSignal;
}

export interface NormalizedErc20TokenHoldingsRequest {
  readonly chain: ChainReference;
  readonly address: string;
  readonly signal?: AbortSignal;
}

export interface NormalizedErc20BalancesAtBlockRequest {
  readonly chain: ChainReference;
  readonly address: string;
  readonly blockNumber: string;
  readonly tokenAddresses: readonly string[];
  readonly signal?: AbortSignal;
}

export interface NormalizedTransactionsRequest {
  readonly operation: "getTransactions";
  readonly chain: ChainReference;
  readonly address: string;
  readonly pageSize: number;
  readonly fullData: boolean;
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
  readonly fullData: boolean;
  readonly order: SortOrder;
  readonly startBlock: string | null;
  readonly endBlock: string | null;
  readonly cursor: string | null;
  readonly signal?: AbortSignal;
}

export interface NormalizedErc20BlockRangeRequest {
  readonly operation: "getErc20TransfersByBlockRange";
  readonly chain: ChainReference;
  readonly address: string;
  readonly startBlock: string;
  readonly endBlock: string;
  readonly tokenAddress: string | null;
  readonly direction: TransferDirection;
  readonly signal?: AbortSignal;
}

const addressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const transactionHashSchema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
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
const pageSizeSchema = z.number().int().min(1).max(MAX_PAGE_SIZE).optional();
const fullDataSchema = z.boolean().default(false);
const orderSchema = z.enum(["asc", "desc"]).default("desc");
const directionSchema = z.enum(["incoming", "outgoing", "both"]).default("both");

const transactionsRequestSchema = z
  .object({
    chain: chainReferenceSchema,
    address: addressSchema.transform((value) => value.toLowerCase()),
    pageSize: pageSizeSchema,
    fullData: fullDataSchema,
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

const transactionContextsByHashRequestSchema = z
  .object({
    chain: chainReferenceSchema,
    transactionHashes: z.array(transactionHashSchema.transform((value) => value.toLowerCase())).min(1).max(20),
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
    fullData: fullDataSchema,
    order: orderSchema,
    startBlock: decimalQuantitySchema.optional(),
    endBlock: decimalQuantitySchema.optional(),
    cursor: cursorSchema.optional(),
    signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
  })
  .strict();

const erc20BlockRangeRequestSchema = z
  .object({
    chain: chainReferenceSchema,
    address: addressSchema.transform((value) => value.toLowerCase()),
    startBlock: decimalQuantitySchema,
    endBlock: decimalQuantitySchema,
    tokenAddress: addressSchema
      .transform((value) => value.toLowerCase())
      .optional(),
    direction: directionSchema,
    signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
  })
  .strict();

const erc20BalancesAtBlockRequestSchema = z
  .object({
    chain: chainReferenceSchema,
    address: addressSchema.transform((value) => value.toLowerCase()),
    blockNumber: decimalQuantitySchema,
    tokenAddresses: z.array(addressSchema.transform((value) => value.toLowerCase())).min(1).max(512),
    signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal).optional(),
  })
  .strict();

const erc20TokenHoldingsRequestSchema = z
  .object({
    chain: chainReferenceSchema,
    address: addressSchema.transform((value) => value.toLowerCase()),
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
    pageSize: parsed.pageSize ?? (parsed.fullData ? MAX_PAGE_SIZE : DEFAULT_PAGE_SIZE),
    fullData: parsed.fullData,
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

export function parseTransactionContextsByHashRequest(input: unknown): NormalizedTransactionContextsByHashRequest {
  const parsed = parseSchema(
    transactionContextsByHashRequestSchema,
    input,
    "transaction-contexts-by-hash request",
  );
  return {
    chain: normalizeChainReference(parsed.chain),
    transactionHashes: Object.freeze([...new Set(parsed.transactionHashes)]),
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
    pageSize: parsed.pageSize ?? (parsed.fullData ? MAX_PAGE_SIZE : DEFAULT_PAGE_SIZE),
    fullData: parsed.fullData,
    order: parsed.order,
    startBlock: parsed.startBlock ?? null,
    endBlock: parsed.endBlock ?? null,
    cursor: parsed.cursor ?? null,
    ...(parsed.signal === undefined ? {} : { signal: parsed.signal }),
  };
}

export function parseErc20BlockRangeRequest(input: unknown): NormalizedErc20BlockRangeRequest {
  const parsed = erc20BlockRangeRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidBlockRange("Invalid ERC-20 block-range request.");
  }
  if (BigInt(parsed.data.startBlock) > BigInt(parsed.data.endBlock)) {
    throw invalidBlockRange("startBlock must not be greater than endBlock.");
  }
  return {
    operation: "getErc20TransfersByBlockRange",
    chain: normalizeChainReference(parsed.data.chain),
    address: parsed.data.address,
    startBlock: parsed.data.startBlock,
    endBlock: parsed.data.endBlock,
    tokenAddress: parsed.data.tokenAddress ?? null,
    direction: parsed.data.direction,
    ...(parsed.data.signal === undefined ? {} : { signal: parsed.data.signal }),
  };
}

export function parseErc20BalancesAtBlockRequest(input: unknown): NormalizedErc20BalancesAtBlockRequest {
  const parsed = parseSchema(
    erc20BalancesAtBlockRequestSchema,
    input,
    "ERC-20 balances-at-block request",
  );
  const tokenAddresses = [...new Set(parsed.tokenAddresses)];
  return {
    chain: normalizeChainReference(parsed.chain),
    address: parsed.address,
    blockNumber: parsed.blockNumber,
    tokenAddresses: Object.freeze(tokenAddresses),
    ...(parsed.signal === undefined ? {} : { signal: parsed.signal }),
  };
}

export function parseErc20TokenHoldingsRequest(input: unknown): NormalizedErc20TokenHoldingsRequest {
  const parsed = parseSchema(
    erc20TokenHoldingsRequestSchema,
    input,
    'ERC-20 token holdings request',
  );
  return {
    chain: normalizeChainReference(parsed.chain),
    address: parsed.address,
    ...(parsed.signal === undefined ? {} : { signal: parsed.signal }),
  };
}

export const normalizeTransactionsRequest = parseTransactionsRequest;
export const normalizeNativeBalanceRequest = parseNativeBalanceRequest;
export const normalizeTransactionContextsByHashRequest = parseTransactionContextsByHashRequest;
export const normalizeErc20TransfersRequest = parseErc20TransfersRequest;
export const normalizeErc20BlockRangeRequest = parseErc20BlockRangeRequest;
export const normalizeErc20BalancesAtBlockRequest = parseErc20BalancesAtBlockRequest;
export const normalizeErc20TokenHoldingsRequest = parseErc20TokenHoldingsRequest;

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
