import type { ChainDefinition } from "../../domain/chains";
import type { Erc20BalanceAtBlock, Erc20TokenHolding, Erc20Transfer, NativeBalance, Transaction, TransactionContext, TransactionReceiptLog } from "../../domain/models";
import type {
  MoralisErc20Balance,
  MoralisNativeBalance,
  MoralisReceiptLog,
  MoralisTokenTransfer,
  MoralisTransaction,
  MoralisTransactionContext,
} from "./moralisSchemas";

export function mapMoralisTransaction(
  value: MoralisTransaction,
  chain: ChainDefinition,
): Transaction {
  return {
    chainId: chain.chainId,
    hash: value.hash.toLowerCase(),
    blockNumber: canonicalQuantity(value.block_number),
    blockHash: nullableHash(value.block_hash),
    transactionIndex: nullableQuantity(value.transaction_index),
    timestamp: mapTimestamp(value.block_timestamp),
    from: value.from_address.toLowerCase(),
    to: nullableAddress(value.to_address),
    nonce: nullableQuantity(value.nonce),
    value: canonicalQuantity(value.value),
    gasLimit: nullableQuantity(value.gas),
    gasUsed: nullableQuantity(value.receipt_gas_used),
    gasPrice: nullableQuantity(value.gas_price),
    input: value.input ?? null,
    status: mapStatus(value.receipt_status),
    provider: "moralis",
  };
}

export function mapMoralisTransactionContext(
  value: MoralisTransactionContext,
  chain: ChainDefinition,
): TransactionContext {
  const transaction = mapMoralisTransaction(value, chain);
  const gasUsed = transaction.gasUsed;
  const effectiveGasPrice = transaction.gasPrice;
  const gasFeeWei = gasUsed === null || effectiveGasPrice === null
    ? null
    : (BigInt(gasUsed) * BigInt(effectiveGasPrice)).toString();
  return {
    chainId: chain.chainId,
    transaction,
    receipt: {
      status: transaction.status,
      gasUsed,
      effectiveGasPrice,
      gasFeeWei,
      contractAddress: nullableAddress(value.receipt_contract_address),
    },
    logs: value.logs.map((log) => mapMoralisReceiptLog(log, chain, transaction.hash)),
    provider: "moralis",
  };
}

function mapMoralisReceiptLog(
  value: MoralisReceiptLog,
  chain: ChainDefinition,
  transactionHash: string,
): TransactionReceiptLog {
  if (value.transaction_hash.toLowerCase() !== transactionHash) {
    throw new Error("Moralis receipt log belongs to a different transaction.");
  }
  const topics = [value.topic0, value.topic1, value.topic2, value.topic3]
    .filter((topic): topic is string => typeof topic === "string" && topic !== "")
    .map((topic) => topic.toLowerCase());
  return {
    chainId: chain.chainId,
    transactionHash,
    blockNumber: canonicalQuantity(value.block_number),
    blockHash: nullableHash(value.block_hash),
    transactionIndex: nullableQuantity(value.transaction_index),
    logIndex: canonicalQuantity(value.log_index),
    address: value.address.toLowerCase(),
    topics,
    data: value.data.toLowerCase(),
    removed: null,
    provider: "moralis",
  };
}

export function mapMoralisNativeBalance(
  value: MoralisNativeBalance,
  chain: ChainDefinition,
  address: string,
): NativeBalance {
  return {
    chainId: chain.chainId,
    address,
    amount: canonicalQuantity(value.balance),
    decimals: value.decimals ?? chain.nativeCurrency.decimals,
    symbol: value.symbol ?? chain.nativeCurrency.symbol,
    blockNumber: null,
    provider: "moralis",
  };
}

export function mapMoralisErc20TokenHolding(
  value: MoralisErc20Balance,
  chain: ChainDefinition,
  address: string,
): Erc20TokenHolding {
  return {
    chainId: chain.chainId,
    address,
    tokenAddress: value.token_address.toLowerCase(),
    tokenName: nullableText(value.name),
    tokenSymbol: nullableText(value.symbol),
    tokenDecimals: mapTokenDecimals(value.decimals),
    amount: canonicalQuantity(value.balance),
    provider: "moralis",
  };
}

/**
 * Moralis returns one complete wallet inventory rather than one contract per
 * request. Duplicate contracts make the inventory ambiguous. A requested
 * contract that is absent from that successful, validated inventory is zero.
 */
export function mapMoralisErc20BalancesAtBlock(
  values: readonly MoralisErc20Balance[],
  chain: ChainDefinition,
  address: string,
  blockNumber: string,
  tokenAddresses: readonly string[],
): readonly Erc20BalanceAtBlock[] {
  const amounts = new Map<string, string>();
  for (const value of values) {
    const tokenAddress = value.token_address.toLowerCase();
    if (amounts.has(tokenAddress)) {
      throw new Error("Moralis returned duplicate ERC-20 balance contracts.");
    }
    amounts.set(tokenAddress, canonicalQuantity(value.balance));
  }
  return tokenAddresses.map((tokenAddress) => ({
    chainId: chain.chainId,
    address,
    tokenAddress,
    blockNumber,
    amount: amounts.get(tokenAddress) ?? "0",
    provider: "moralis",
  }));
}

export function mapMoralisTokenTransfer(
  value: MoralisTokenTransfer,
  chain: ChainDefinition,
): Erc20Transfer {
  const tokenAddress = firstAddress(value.address, value.contract_address);
  const from = firstAddress(value.from_address, value.from_wallet);
  const to = firstAddress(value.to_address, value.to_wallet);
  if (tokenAddress === null || from === null || to === null) {
    throw new Error("Moralis transfer is missing a required address.");
  }

  return {
    chainId: chain.chainId,
    transactionHash: value.transaction_hash.toLowerCase(),
    transactionIndex: nullableQuantity(value.transaction_index),
    logIndex: nullableQuantity(value.log_index),
    blockNumber: canonicalQuantity(value.block_number),
    timestamp: mapTimestamp(value.block_timestamp),
    tokenAddress,
    tokenName: nullableText(value.token_name),
    tokenSymbol: nullableText(value.token_symbol),
    tokenDecimals: mapTokenDecimals(value.token_decimals ?? value.decimals),
    from,
    to,
    amount: canonicalQuantity(value.value),
    provider: "moralis",
  };
}

function canonicalQuantity(value: string | number): string {
  const text = typeof value === "number" ? String(value) : value;
  if (!/^[0-9]+$/.test(text)) {
    throw new Error("Moralis returned a non-decimal quantity.");
  }
  const normalized = text.replace(/^0+(?=\d)/, "");
  return normalized === "" ? "0" : normalized;
}

function nullableQuantity(value: string | number | null | undefined): string | null {
  return value === undefined || value === null ? null : canonicalQuantity(value);
}

function nullableAddress(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === "" ? null : value.toLowerCase();
}

function nullableHash(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === "" ? null : value.toLowerCase();
}

function firstAddress(...values: readonly (string | null | undefined)[]): string | null {
  const value = values.find((entry) => entry !== undefined && entry !== null && entry !== "");
  return value === undefined || value === null ? null : value.toLowerCase();
}

function nullableText(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === "" ? null : value;
}

function mapTokenDecimals(value: string | number | null | undefined): number | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 255) {
    throw new Error("Moralis returned invalid token decimals.");
  }
  return parsed;
}

function mapTimestamp(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error("Moralis returned an invalid timestamp.");
  }
  return new Date(timestamp).toISOString();
}

function mapStatus(value: string | number | null | undefined): Transaction["status"] {
  if (value === "1" || value === 1) {
    return "success";
  }
  if (value === "0" || value === 0) {
    return "reverted";
  }
  return "unknown";
}
