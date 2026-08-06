import type { ChainDefinition } from "../../domain/chains";
import type { Erc20Transfer, NativeBalance, Transaction } from "../../domain/models";
import type { EtherscanTokenTransfer, EtherscanTransaction } from "./etherscanSchemas";

export function mapEtherscanTransaction(
  value: EtherscanTransaction,
  chain: ChainDefinition,
): Transaction {
  const isError = value.isError ?? null;
  const receiptStatus = value.txreceipt_status ?? null;
  const status: Transaction["status"] = isError === "1" || receiptStatus === "0"
    ? "reverted"
    : isError === "0" || receiptStatus === "1"
      ? "success"
      : "unknown";

  return {
    chainId: chain.chainId,
    hash: value.hash.toLowerCase(),
    blockNumber: canonicalDecimal(value.blockNumber),
    blockHash: normalizeNullableHash(value.blockHash),
    transactionIndex: normalizeNullableDecimal(value.transactionIndex),
    timestamp: mapTimestamp(value.timeStamp),
    from: value.from.toLowerCase(),
    to: normalizeNullableAddress(value.to),
    nonce: normalizeNullableDecimal(value.nonce),
    value: canonicalDecimal(value.value),
    gasLimit: normalizeNullableDecimal(value.gas),
    gasUsed: normalizeNullableDecimal(value.gasUsed),
    gasPrice: normalizeNullableDecimal(value.gasPrice),
    input: value.input ?? null,
    status,
    provider: "etherscan",
  };
}

export function mapEtherscanBalance(
  amount: string,
  chain: ChainDefinition,
  address: string,
): NativeBalance {
  return {
    chainId: chain.chainId,
    address,
    amount: canonicalDecimal(amount),
    decimals: chain.nativeCurrency.decimals,
    symbol: chain.nativeCurrency.symbol,
    blockNumber: null,
    provider: "etherscan",
  };
}

export function mapEtherscanTokenTransfer(
  value: EtherscanTokenTransfer,
  chain: ChainDefinition,
): Erc20Transfer {
  return {
    chainId: chain.chainId,
    transactionHash: value.transactionHash === undefined || value.transactionHash === null || value.transactionHash === ""
      ? value.hash.toLowerCase()
      : value.transactionHash.toLowerCase(),
    transactionIndex: normalizeNullableDecimal(value.transactionIndex),
    logIndex: normalizeNullableDecimal(value.logIndex),
    blockNumber: canonicalDecimal(value.blockNumber),
    timestamp: mapTimestamp(value.timeStamp),
    tokenAddress: value.contractAddress.toLowerCase(),
    tokenName: normalizeNullableText(value.tokenName),
    tokenSymbol: normalizeNullableText(value.tokenSymbol),
    tokenDecimals: value.tokenDecimal === undefined || value.tokenDecimal === null || value.tokenDecimal === ""
      ? null
      : parseTokenDecimals(value.tokenDecimal),
    from: value.from.toLowerCase(),
    to: value.to.toLowerCase(),
    amount: canonicalDecimal(value.value),
    provider: "etherscan",
  };
}

function canonicalDecimal(value: string): string {
  const normalized = value.replace(/^0+(?=\d)/, "");
  return normalized === "" ? "0" : normalized;
}

function normalizeNullableDecimal(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === "" ? null : canonicalDecimal(value);
}

function normalizeNullableHash(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === "" ? null : value.toLowerCase();
}

function normalizeNullableAddress(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === "" ? null : value.toLowerCase();
}

function normalizeNullableText(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === "" ? null : value;
}

function parseTokenDecimals(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 255) {
    throw new Error("Invalid token decimals.");
  }
  return parsed;
}

function mapTimestamp(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const milliseconds = BigInt(value) * 1_000n;
  const numeric = Number(milliseconds);
  if (!Number.isSafeInteger(numeric) || numeric < 0 || numeric > 8_640_000_000_000_000) {
    throw new Error("Invalid timestamp.");
  }
  return new Date(numeric).toISOString();
}
