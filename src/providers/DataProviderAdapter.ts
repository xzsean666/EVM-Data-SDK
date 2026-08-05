import type { ChainDefinition, ProviderName } from "../domain/chains";
import type { EvmDataError } from "../domain/errors";
import { invalidConfiguration } from "../domain/errors";
import type {
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
  | NormalizedErc20TransfersRequest;

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
