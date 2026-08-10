import type { ChainDefinition, ProviderName } from "../../domain/chains";
import type { BeaconWithdrawal, Erc20TokenHolding, Erc20Transfer, InternalNativeTransfer, NativeBalance, Transaction } from "../../domain/models";
import type { EtherscanBeaconWithdrawal, EtherscanInternalTransaction, EtherscanTokenHolding, EtherscanTokenTransfer, EtherscanTransaction } from "./etherscanSchemas";

export function mapEtherscanTransaction(
  value: EtherscanTransaction,
  chain: ChainDefinition,
  provider: ProviderName = "etherscan",
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
    provider,
  };
}

export function mapEtherscanBalance(
  amount: string,
  chain: ChainDefinition,
  address: string,
  provider: ProviderName = "etherscan",
): NativeBalance {
  return {
    chainId: chain.chainId,
    address,
    amount: canonicalDecimal(amount),
    decimals: chain.nativeCurrency.decimals,
    symbol: chain.nativeCurrency.symbol,
    blockNumber: null,
    provider,
  };
}

export function mapEtherscanTokenTransfer(
  value: EtherscanTokenTransfer,
  chain: ChainDefinition,
  provider: ProviderName = "etherscan",
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
    provider,
  };
}

export function mapEtherscanInternalTransaction(
  value: EtherscanInternalTransaction,
  chain: ChainDefinition,
  provider: ProviderName = "etherscan",
): InternalNativeTransfer {
  return {
    chainId: chain.chainId,
    transactionHash: value.hash.toLowerCase(),
    traceId: normalizeNullableText(value.traceId),
    blockNumber: canonicalDecimal(value.blockNumber),
    timestamp: mapTimestamp(value.timeStamp),
    from: value.from.toLowerCase(),
    to: value.to.toLowerCase(),
    value: canonicalDecimal(value.value),
    type: normalizeNullableText(value.type),
    status: value.isError === "1" ? "reverted" : value.isError === "0" ? "success" : "unknown",
    provider,
  };
}

export function mapEtherscanBeaconWithdrawal(
  value: EtherscanBeaconWithdrawal,
  chain: ChainDefinition,
  provider: ProviderName = "etherscan",
): BeaconWithdrawal {
  return {
    chainId: chain.chainId,
    withdrawalIndex: canonicalDecimal(value.withdrawalIndex),
    validatorIndex: normalizeNullableDecimal(value.validatorIndex),
    blockNumber: canonicalDecimal(value.blockNumber),
    timestamp: mapTimestamp(value.timestamp ?? value.timeStamp ?? value.blockTimestamp),
    address: value.address.toLowerCase(),
    amount: canonicalDecimal(value.amount),
    amountDecimals: 9,
    provider,
  };
}

export function mapEtherscanTokenHolding(
  value: EtherscanTokenHolding,
  chain: ChainDefinition,
  address: string,
  provider: ProviderName = "etherscan",
): Erc20TokenHolding {
  return {
    chainId: chain.chainId,
    address,
    tokenAddress: value.TokenAddress.toLowerCase(),
    tokenName: normalizeNullableText(value.TokenName),
    tokenSymbol: normalizeNullableText(value.TokenSymbol),
    tokenDecimals: value.TokenDivisor === undefined || value.TokenDivisor === null || value.TokenDivisor === ''
      ? null
      : parseTokenDecimals(value.TokenDivisor),
    amount: canonicalDecimal(value.TokenQuantity),
    provider,
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
