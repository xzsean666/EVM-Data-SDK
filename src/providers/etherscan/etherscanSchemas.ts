import { z } from "zod";

const decimalString = z.string().regex(/^[0-9]+$/);
const optionalDecimalString = z.union([decimalString, z.literal("")]).nullable().optional();
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]+$/);
const nullableString = z.string().nullable().optional();

export const etherscanEnvelopeSchema = z
  .object({
    status: z.enum(["0", "1"]),
    message: z.string(),
    result: z.unknown(),
  })
  .passthrough();

export const etherscanTransactionSchema = z
  .object({
    blockNumber: decimalString,
    timeStamp: optionalDecimalString,
    hash,
    nonce: optionalDecimalString,
    blockHash: z.union([hash, z.literal("")]).nullable().optional(),
    from: address,
    to: z.union([address, z.literal(""), z.null()]).optional(),
    value: decimalString,
    transactionIndex: optionalDecimalString,
    gas: optionalDecimalString,
    gasUsed: optionalDecimalString,
    gasPrice: optionalDecimalString,
    input: z.string().nullable().optional(),
    isError: z.string().nullable().optional(),
    txreceipt_status: z.string().nullable().optional(),
  })
  .passthrough();

export const etherscanTokenTransferSchema = z
  .object({
    blockNumber: decimalString,
    timeStamp: optionalDecimalString,
    hash,
    transactionHash: z.union([hash, z.literal("")]).nullable().optional(),
    transactionIndex: optionalDecimalString,
    logIndex: optionalDecimalString,
    from: address,
    to: address,
    contractAddress: address,
    value: decimalString,
    tokenName: nullableString,
    tokenSymbol: nullableString,
    tokenDecimal: optionalDecimalString,
  })
  .passthrough();

export const etherscanInternalTransactionSchema = z
  .object({
    blockNumber: decimalString,
    timeStamp: optionalDecimalString,
    hash,
    from: address,
    to: address,
    value: decimalString,
    traceId: nullableString,
    type: nullableString,
    isError: nullableString,
  })
  .passthrough();

export const etherscanBeaconWithdrawalSchema = z
  .object({
    withdrawalIndex: decimalString,
    validatorIndex: optionalDecimalString,
    blockNumber: decimalString,
    timestamp: optionalDecimalString,
    timeStamp: optionalDecimalString,
    blockTimestamp: optionalDecimalString,
    address,
    amount: decimalString,
  })
  .passthrough();

export const etherscanTokenHoldingSchema = z
  .object({
    TokenAddress: address,
    TokenName: nullableString,
    TokenSymbol: nullableString,
    TokenQuantity: decimalString,
    TokenDivisor: optionalDecimalString,
  })
  .passthrough();

export const etherscanTransactionListEnvelopeSchema = etherscanEnvelopeSchema.extend({
  result: z.union([z.array(etherscanTransactionSchema), z.string()]),
});

export const etherscanTokenTransferEnvelopeSchema = etherscanEnvelopeSchema.extend({
  result: z.union([z.array(etherscanTokenTransferSchema), z.string()]),
});

export const etherscanBalanceEnvelopeSchema = etherscanEnvelopeSchema.extend({
  result: z.unknown(),
});

export const etherscanInternalTransactionEnvelopeSchema = etherscanEnvelopeSchema.extend({
  result: z.union([z.array(etherscanInternalTransactionSchema), z.string()]),
});

export const etherscanBeaconWithdrawalEnvelopeSchema = etherscanEnvelopeSchema.extend({
  result: z.union([z.array(etherscanBeaconWithdrawalSchema), z.string()]),
});

export const etherscanTokenHoldingEnvelopeSchema = etherscanEnvelopeSchema.extend({
  result: z.union([z.array(etherscanTokenHoldingSchema), z.string()]),
});

export type EtherscanEnvelope = z.infer<typeof etherscanEnvelopeSchema>;
export type EtherscanTransaction = z.infer<typeof etherscanTransactionSchema>;
export type EtherscanTokenTransfer = z.infer<typeof etherscanTokenTransferSchema>;
export type EtherscanInternalTransaction = z.infer<typeof etherscanInternalTransactionSchema>;
export type EtherscanBeaconWithdrawal = z.infer<typeof etherscanBeaconWithdrawalSchema>;
export type EtherscanTokenHolding = z.infer<typeof etherscanTokenHoldingSchema>;
