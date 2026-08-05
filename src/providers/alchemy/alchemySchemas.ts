import { z } from "zod";

const hexQuantity = z.string().regex(/^0x[0-9a-fA-F]+$/);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]+$/);

const rawContractSchema = z.object({
  address: address.nullable().optional(),
  decimal: z.string().nullable().optional(),
  decimals: z.number().int().nonnegative().max(255).nullable().optional(),
  value: hexQuantity.nullable().optional(),
}).passthrough();

const transferSchema = z.object({
  category: z.string(),
  asset: z.string().nullable().optional(),
  from: address,
  to: address,
  hash,
  blockNum: hexQuantity,
  rawContract: rawContractSchema,
  metadata: z.object({ blockTimestamp: z.string().nullable().optional() }).passthrough().optional(),
}).passthrough();

export const alchemyJsonRpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0").optional(),
  id: z.union([z.string(), z.number()]).optional(),
  result: z.unknown().optional(),
  error: z.object({
    code: z.number().int(),
    message: z.string(),
    data: z.unknown().optional(),
  }).passthrough().optional(),
}).passthrough();

export const alchemyBalanceResultSchema = hexQuantity;

export const alchemyTransfersResultSchema = z.object({
  transfers: z.array(transferSchema),
  pageKey: z.string().min(1).nullable().optional(),
}).passthrough();

export type AlchemyTransfer = z.infer<typeof transferSchema>;
export type AlchemyTransfersResult = z.infer<typeof alchemyTransfersResultSchema>;
