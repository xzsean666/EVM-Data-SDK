import type { ChainDefinition, ProviderName } from "../domain/chains";
import type { EvmDataError } from "../domain/errors";
import { invalidConfiguration } from "../domain/errors";
import type {
  NormalizedErc20BlockRangeRequest,
  NormalizedErc20TransfersRequest,
  NormalizedNativeBalanceRequest,
  NormalizedTransactionsRequest,
  OperationName,
} from "../domain/operations";
import type { ProviderPageResult } from "../domain/pagination";
import type { Erc20Transfer, NativeBalance, Transaction } from "../domain/models";

export interface CredentialLease {
  readonly id: string;
  readonly value: string;
  readonly leaseToken?: number;
}

export interface ProxyLease {
  readonly id: string;
  readonly url: string;
  readonly leaseToken?: number;
}

export interface ProviderAttemptContext {
  readonly chain: ChainDefinition;
  readonly credential: CredentialLease | null;
  readonly proxy: ProxyLease | null;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly providerPageState?: unknown;
  readonly correlationId: string;
}

export type NormalizedProviderRequest =
  | NormalizedTransactionsRequest
  | NormalizedNativeBalanceRequest
  | NormalizedErc20TransfersRequest
  | NormalizedErc20BlockRangeRequest;

/** A provider-private stable identity for one range result. */
export interface ProviderBlockRangeItem {
  readonly item: Erc20Transfer;
  /**
   * A provider documented stable identity when logIndex is unavailable. It is
   * not exposed as a fabricated log index.
   */
  readonly identityKey: string | null;
}

/** One new provider request for one inclusive block window. */
export interface ProviderBlockRangeWindowResult {
  readonly items: readonly ProviderBlockRangeItem[];
  readonly complete: boolean;
  readonly pageInfo: {
    readonly provider: ProviderName;
    readonly chainId: number;
  };
}

export interface CapabilityRequest {
  readonly operation: OperationName;
  readonly chain: ChainDefinition;
  readonly request: NormalizedProviderRequest;
  readonly continuation: boolean;
}

export interface DataProviderAdapter {
  readonly name: ProviderName;

  supports(request: CapabilityRequest): boolean;

  getTransactions?(
    request: NormalizedTransactionsRequest,
    context: ProviderAttemptContext,
  ): Promise<ProviderPageResult<Transaction>>;

  getNativeBalance?(
    request: NormalizedNativeBalanceRequest,
    context: ProviderAttemptContext,
  ): Promise<NativeBalance>;

  getErc20Transfers?(
    request: NormalizedErc20TransfersRequest,
    context: ProviderAttemptContext,
  ): Promise<ProviderPageResult<Erc20Transfer>>;

  getErc20TransfersByBlockRangeWindow?(
    request: NormalizedErc20BlockRangeRequest,
    context: ProviderAttemptContext,
  ): Promise<ProviderBlockRangeWindowResult>;
}

export type ProviderAdapterFailure = EvmDataError;

export function isProviderName(value: string): value is ProviderName {
  return value.trim().length > 0;
}

export function validateProviderName(value: string): ProviderName {
  const normalized = value.trim();
  if (!isProviderName(normalized)) {
    throw invalidConfiguration("Provider name must be a non-empty string.");
  }
  return normalized;
}
