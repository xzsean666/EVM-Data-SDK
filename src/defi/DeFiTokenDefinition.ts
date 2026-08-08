import type { DeFiTokenKind } from "../domain/defiExchangeRateModels";

export type DeFiAdapterKind = "fixed-ratio" | "aave-v2" | "aave-v3" | "wsteth" | "rocket-reth" | "cbeth" | "erc4626" | "compound-v2" | "uniswap-v2-lp" | "curve-3pool-lp" | "aerodrome-lp" | "balancer-bpt";

export interface DeFiUnderlyingDefinition {
  readonly address: string | null;
  readonly symbol: string;
  readonly decimals: number;
  readonly isNative: boolean;
  readonly chainlinkAssetSymbol?: string;
}

export interface DeFiTokenDefinition {
  readonly id: string;
  readonly chainId: 1 | 8453;
  readonly protocol: string;
  readonly kind: DeFiTokenKind;
  readonly tokenAddress: string;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly underlyings: readonly DeFiUnderlyingDefinition[];
  readonly adapter: DeFiAdapterKind;
  readonly sampleTokenAmount: string;
  /** Fixed protocol target and identifier required by pool adapters. */
  readonly adapterTarget?: string;
  readonly adapterPoolId?: string;
  /** Chainlink feed asset identity proven for the underlying at manifest review time. */
  readonly chainlinkAssetSymbol?: string;
  readonly deploymentBlock?: string;
}
