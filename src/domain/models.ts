import type { ProviderName } from "./chains";

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
  pageInfo: {
    provider: ProviderName;
    chainId: number;
  };
}

export interface Transaction {
  chainId: number;
  hash: string;
  blockNumber: string;
  blockHash: string | null;
  transactionIndex: string | null;
  timestamp: string | null;
  from: string;
  to: string | null;
  nonce: string | null;
  value: string;
  gasLimit: string | null;
  gasUsed: string | null;
  gasPrice: string | null;
  input: string | null;
  status: "success" | "reverted" | "unknown";
  provider: ProviderName;
}

/** One immutable receipt log returned by an indexed transaction-detail API. */
export interface TransactionReceiptLog {
  chainId: number;
  transactionHash: string;
  blockNumber: string;
  blockHash: string | null;
  transactionIndex: string | null;
  logIndex: string;
  address: string;
  topics: readonly string[];
  data: string;
  /** `null` when the indexed API does not expose a removal marker. */
  removed: boolean | null;
  provider: ProviderName;
}

export interface TransactionReceipt {
  status: Transaction["status"];
  gasUsed: string | null;
  effectiveGasPrice: string | null;
  gasFeeWei: string | null;
  contractAddress: string | null;
}

/** Transaction envelope plus receipt fields and all receipt logs. */
export interface TransactionContext {
  chainId: number;
  transaction: Transaction;
  receipt: TransactionReceipt;
  logs: readonly TransactionReceiptLog[];
  provider: ProviderName;
}

/** A complete, bounded set of transaction contexts requested by hash. */
export interface TransactionContextsByHashResult {
  chainId: number;
  items: readonly TransactionContext[];
  provider: ProviderName;
  upstreamRequests: number;
}

export interface NativeBalance {
  chainId: number;
  address: string;
  amount: string;
  decimals: number;
  symbol: string;
  blockNumber: string | null;
  provider: ProviderName;
}

export interface Erc20Transfer {
  chainId: number;
  transactionHash: string;
  transactionIndex: string | null;
  logIndex: string | null;
  blockNumber: string;
  timestamp: string | null;
  tokenAddress: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenDecimals: number | null;
  from: string;
  to: string;
  amount: string;
  provider: ProviderName;
}

/** One ERC-20 contract balance at an exact canonical historical block. */
export interface Erc20BalanceAtBlock {
  chainId: number;
  address: string;
  tokenAddress: string;
  blockNumber: string;
  /** Raw token quantity in the contract's smallest unit. */
  amount: string;
  provider: ProviderName;
}

/**
 * A caller-supplied set of ERC-20 balances at one exact block. The SDK never
 * pretends that an explorer can enumerate every token ever held by a wallet.
 */
export interface Erc20BalancesAtBlock {
  chainId: number;
  address: string;
  blockNumber: string;
  items: readonly Erc20BalanceAtBlock[];
  provider: ProviderName;
}

/** Current indexed holding metadata used only to discover contract addresses. */
export interface Erc20TokenHolding {
  chainId: number;
  address: string;
  tokenAddress: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenDecimals: number | null;
  /** Current raw quantity; it is not a historical balance assertion. */
  amount: string;
  provider: ProviderName;
}

export interface Erc20TokenHoldings {
  chainId: number;
  address: string;
  items: readonly Erc20TokenHolding[];
  provider: ProviderName;
  pages: number;
  upstreamRequests: number;
}

export interface BlockRange {
  readonly startBlock: string;
  readonly endBlock: string;
}

export interface Erc20BlockRangeStats {
  readonly windows: number;
  readonly upstreamRequests: number;
  readonly duplicateItemsRemoved: number;
  readonly providerWindows: Readonly<Record<string, number>>;
}

export interface Erc20BlockRangeResult {
  readonly chainId: number;
  readonly address: string;
  readonly range: BlockRange;
  readonly direction: "incoming" | "outgoing" | "both";
  readonly items: readonly Erc20Transfer[];
  readonly providers: readonly ProviderName[];
  readonly stats: Erc20BlockRangeStats;
}

/** One complete, closed ERC-20 range window emitted during a streamed scan. */
export interface Erc20BlockRangeWindow {
  readonly chainId: number;
  readonly address: string;
  readonly range: BlockRange;
  readonly items: readonly Erc20Transfer[];
  readonly provider: ProviderName;
  readonly upstreamRequests: number;
}

export interface TransactionBlockRange {
  readonly chainId: number;
  readonly address: string;
  readonly range: BlockRange;
  readonly items: readonly Transaction[];
  readonly provider: ProviderName;
  readonly pages: number;
  readonly upstreamRequests: number;
}

/** One complete, closed transaction range window emitted during a streamed scan. */
export interface TransactionBlockRangeWindow {
  readonly chainId: number;
  readonly address: string;
  readonly range: BlockRange;
  readonly items: readonly Transaction[];
  readonly provider: ProviderName;
  readonly upstreamRequests: number;
}

/** Indexed explorer representation of one EVM internal native-value trace. */
export interface InternalNativeTransfer {
  readonly chainId: number;
  readonly transactionHash: string;
  readonly traceId: string | null;
  readonly blockNumber: string;
  readonly timestamp: string | null;
  readonly from: string;
  readonly to: string;
  /** Native value in the chain's smallest unit (wei for Ethereum/Base). */
  readonly value: string;
  readonly type: string | null;
  readonly status: "success" | "reverted" | "unknown";
  readonly provider: ProviderName;
}

export interface InternalNativeTransferBlockRange {
  readonly chainId: number;
  readonly address: string;
  readonly range: BlockRange;
  readonly items: readonly InternalNativeTransfer[];
  readonly provider: ProviderName;
  readonly pages: number;
  readonly upstreamRequests: number;
}

/** One complete, closed internal-native range window emitted during a scan. */
export interface InternalNativeTransferBlockRangeWindow {
  readonly chainId: number;
  readonly address: string;
  readonly range: BlockRange;
  readonly items: readonly InternalNativeTransfer[];
  readonly provider: ProviderName;
  readonly upstreamRequests: number;
}

/** EIP-4895 withdrawal. `amount` is Gwei, as returned by the indexed API. */
export interface BeaconWithdrawal {
  readonly chainId: number;
  readonly withdrawalIndex: string;
  readonly validatorIndex: string | null;
  readonly blockNumber: string;
  readonly timestamp: string | null;
  readonly address: string;
  readonly amount: string;
  readonly amountDecimals: 9;
  readonly provider: ProviderName;
}

export interface BeaconWithdrawalBlockRange {
  readonly chainId: number;
  readonly address: string;
  readonly range: BlockRange;
  readonly items: readonly BeaconWithdrawal[];
  readonly provider: ProviderName;
  readonly pages: number;
  readonly upstreamRequests: number;
}

/** One complete, closed Beacon-withdrawal range window emitted during a scan. */
export interface BeaconWithdrawalBlockRangeWindow {
  readonly chainId: number;
  readonly address: string;
  readonly range: BlockRange;
  readonly items: readonly BeaconWithdrawal[];
  readonly provider: ProviderName;
  readonly upstreamRequests: number;
}
