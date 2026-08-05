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

export const etherscanTransactionListEnvelopeSchema = etherscanEnvelopeSchema.extend({
  result: z.union([z.array(etherscanTransactionSchema), z.string()]),
});

export const etherscanTokenTransferEnvelopeSchema = etherscanEnvelopeSchema.extend({
  result: z.union([z.array(etherscanTokenTransferSchema), z.string()]),
});

export const etherscanBalanceEnvelopeSchema = etherscanEnvelopeSchema.extend({
  result: z.unknown(),
});

export type EtherscanEnvelope = z.infer<typeof etherscanEnvelopeSchema>;
export type EtherscanTransaction = z.infer<typeof etherscanTransactionSchema>;
export type EtherscanTokenTransfer = z.infer<typeof etherscanTokenTransferSchema>;
