import { z } from "zod";

const decimalString = z.string().regex(/^[0-9]+$/);
const quantity = z.union([
  decimalString,
  z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
]);
const optionalQuantity = quantity.nullable().optional();
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]+$/);
const optionalAddress = z.union([address, z.literal(""), z.null()]).optional();
const optionalHash = z.union([hash, z.literal(""), z.null()]).optional();
const optionalText = z.string().nullable().optional();

export const moralisTransactionSchema = z
  .object({
    hash,
    nonce: optionalQuantity,
    transaction_index: optionalQuantity,
    from_address: address,
    to_address: optionalAddress,
    value: quantity,
    gas: optionalQuantity,
    gas_price: optionalQuantity,
    input: z.string().nullable().optional(),
    receipt_gas_used: optionalQuantity,
    receipt_contract_address: optionalAddress,
    receipt_status: z.union([z.string(), z.number().int().nonnegative()]).nullable().optional(),
    block_timestamp: z.string().nullable().optional(),
    block_number: quantity,
    block_hash: optionalHash,
  })
  .passthrough();

export const moralisTransactionCollectionSchema = z
  .object({
    result: z.array(moralisTransactionSchema),
    cursor: z.string().nullable().optional(),
    page: z.number().int().nonnegative().optional(),
    page_size: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export const moralisNativeBalanceSchema = z
  .object({
    balance: quantity,
    decimals: z.number().int().nonnegative().max(255).optional(),
    symbol: z.string().nullable().optional(),
  })
  .passthrough();

export const moralisTokenTransferSchema = z
  .object({
    token_name: optionalText,
    token_symbol: optionalText,
    token_decimals: optionalQuantity,
    decimals: optionalQuantity,
    address: optionalAddress,
    contract_address: optionalAddress,
    transaction_hash: hash,
    block_timestamp: z.string().nullable().optional(),
    block_number: quantity,
    block_hash: optionalHash,
    to_address: optionalAddress,
    to_wallet: optionalAddress,
    from_address: optionalAddress,
    from_wallet: optionalAddress,
    value: quantity,
    transaction_index: optionalQuantity,
    log_index: optionalQuantity,
    possible_spam: z.boolean().optional(),
    verified_contract: z.boolean().optional(),
  })
  .passthrough();

export const moralisTokenTransferCollectionSchema = z
  .object({
    result: z.array(moralisTokenTransferSchema),
    cursor: z.string().nullable().optional(),
    page: z.number().int().nonnegative().optional(),
    page_size: z.number().int().nonnegative().optional(),
  })
  .passthrough();

export type MoralisTransaction = z.infer<typeof moralisTransactionSchema>;
export type MoralisNativeBalance = z.infer<typeof moralisNativeBalanceSchema>;
export type MoralisTokenTransfer = z.infer<typeof moralisTokenTransferSchema>;
