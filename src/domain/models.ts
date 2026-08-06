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
