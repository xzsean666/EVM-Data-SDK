import type { ChainReference, ProviderName } from "./chains";
import type { OperationName } from "./operations";

export const MAX_CURSOR_LENGTH = 4096;

export interface PageInfo {
  readonly provider: ProviderName;
  readonly chainId: number;
}

export interface ProviderPageResult<T, TPageState = unknown> {
  readonly items: T[];
  readonly nextPageState: TPageState | null;
  readonly pageInfo: PageInfo;
}

export interface CursorIdentity {
  readonly version: 1;
  readonly operation: OperationName;
  readonly provider: ProviderName;
  readonly providerConfigurationId: string;
  readonly chainId: number;
  readonly queryFingerprint: string;
  readonly providerPageState: unknown;
}

export interface ContinuationRequest {
  readonly cursor: string;
  readonly operation: OperationName;
  readonly chain: ChainReference;
  readonly queryFingerprint: string;
}
