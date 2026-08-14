export interface PriceUpdateRequest {
  readonly token: string;
  readonly exchange: string;
  readonly market?: string;
  readonly quote?: string;
  readonly quoteCurrency?: string;
  readonly interval?: string;
  readonly fromTimestamp?: string | Date;
  readonly toTimestamp?: string | Date;
  readonly signal?: AbortSignal;
}

export interface PriceUpdateResult {
  readonly status: "completed" | "partial" | "busy" | "failed";
  readonly scopeKey: string;
  readonly tokenKey: string;
  readonly exchange: string;
  readonly market: string | null;
  readonly quoteCurrency: string | null;
  readonly interval: string;
  readonly fromTimestamp?: string;
  readonly toTimestamp?: string;
  readonly requestedRange: { fromTimestamp: string; toTimestamp: string };
  readonly coveredRange: { start: string; end: string } | null;
  readonly nextFromTimestamp: string | null;
  readonly recordsSeen: number;
  readonly recordsWritten: number;
  readonly pointsWritten: number;
  readonly hasNext: boolean;
  readonly provider: string | null;
  readonly runId: string;
  readonly errorCode?: string;
}

export interface PriceRecollectRequest extends PriceUpdateRequest {
  readonly fromTimestamp: string | Date;
  readonly toTimestamp: string | Date;
  readonly strategy?: "replace" | "merge";
  readonly dryRun?: boolean;
  readonly reason?: string;
}

export interface PricePointQuery {
  readonly token: string;
  readonly exchange?: string;
  readonly market?: string;
  readonly quote?: string;
  readonly quoteCurrency?: string;
  readonly interval?: string;
  readonly timestamp: string | Date;
  readonly mode?: "before" | "after" | "nearest";
  readonly direction?: "before" | "after" | "nearest";
  readonly maxDistanceMs?: string;
}

export interface PriceSyncScopeRequest { readonly token: string; readonly exchange: string; readonly market?: string; readonly quote?: string; readonly quoteCurrency?: string; readonly interval?: string; }

export interface PriceAtResult {
  readonly status: "priced" | "missing" | "unsupported" | "ambiguous";
  readonly state: "priced" | "missing" | "unsupported" | "ambiguous";
  readonly tokenKey: string;
  readonly timestamp: string;
  readonly requestedTimestamp: string;
  readonly price: string | null;
  readonly rawPoint?: unknown;
  readonly priceTimestamp: string | null;
  readonly distanceMs: string | null;
  readonly exchange: string | null;
  readonly market: string | null;
  readonly quoteCurrency: string | null;
}
