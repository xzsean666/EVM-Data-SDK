export type ErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_REQUEST"
  | "INVALID_BLOCK_RANGE"
  | "INVALID_CURSOR"
  | "UNSUPPORTED_CHAIN"
  | "UNSUPPORTED_OPERATION"
  | "AUTHENTICATION_FAILED"
  | "PLAN_RESTRICTED"
  | "RATE_LIMITED"
  | "REQUEST_TIMEOUT"
  | "REQUEST_ABORTED"
  | "NETWORK_ERROR"
  | "PROXY_ERROR"
  | "INVALID_PROVIDER_RESPONSE"
  | "PROVIDER_UNAVAILABLE"
  | "TOKEN_NOT_FOUND"
  | "TOKEN_AMBIGUOUS"
  | "MARKET_NOT_FOUND"
  | "HISTORY_NOT_AVAILABLE"
  | "PRICE_DATA_UNAVAILABLE"
  | "BLOCK_RANGE_UNSUPPORTED"
  | "BLOCK_RANGE_INCOMPLETE"
  | "BLOCK_RANGE_STALLED"
  | "RANGE_RESULT_TOO_LARGE"
  | "SING_BOX_PLATFORM_UNSUPPORTED"
  | "SING_BOX_VERSION_INVALID"
  | "SING_BOX_DOWNLOAD_FAILED"
  | "SING_BOX_CHECKSUM_MISMATCH"
  | "SING_BOX_START_FAILED"
  | "SING_BOX_START_TIMEOUT"
  | "SING_BOX_EXITED"
  | "SING_BOX_CONFIG_INVALID"
  | "PROXY_NOT_READY";

export interface EvmDataErrorOptions {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly provider?: string | null;
  readonly chainId?: number | null;
  readonly retryAfterMs?: number | null;
  readonly cause?: unknown;
}

export class EvmDataError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly provider: string | null;
  readonly chainId: number | null;
  readonly retryAfterMs: number | null;
  override readonly cause: unknown;

  constructor(options: EvmDataErrorOptions) {
    const safeCause = sanitizeCause(options.cause);
    if (safeCause !== undefined) {
      super(options.message, { cause: safeCause });
    } else {
      super(options.message);
    }

    this.name = "EvmDataError";
    this.code = options.code;
    this.retryable = options.retryable;
    this.provider = options.provider ?? null;
    this.chainId = options.chainId ?? null;
    this.retryAfterMs = options.retryAfterMs ?? null;
    if (safeCause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        enumerable: false,
        value: safeCause,
        writable: false,
      });
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

function sanitizeCause(value: unknown): unknown {
  if (value === undefined) {
    return undefined;
  }
  if (value instanceof Error) {
    const result: Record<string, string | number> = { name: value.name };
    const candidate = value as Error & { code?: unknown; status?: unknown };
    if (typeof candidate.code === "string" || typeof candidate.code === "number") {
      result.code = candidate.code;
    }
    if (typeof candidate.status === "number") {
      result.status = candidate.status;
    }
    return Object.freeze(result);
  }
  if (value === null) {
    return Object.freeze({ type: "null" });
  }
  return Object.freeze({ type: typeof value });
}

export function isEvmDataError(value: unknown): value is EvmDataError {
  return value instanceof EvmDataError;
}

export function invalidConfiguration(message: string, cause?: unknown): EvmDataError {
  return new EvmDataError({
    code: "INVALID_CONFIGURATION",
    message,
    retryable: false,
    ...(cause === undefined ? {} : { cause }),
  });
}

export function invalidRequest(message: string, cause?: unknown): EvmDataError {
  return new EvmDataError({
    code: "INVALID_REQUEST",
    message,
    retryable: false,
    ...(cause === undefined ? {} : { cause }),
  });
}

export function invalidBlockRange(message: string, cause?: unknown): EvmDataError {
  return new EvmDataError({
    code: "INVALID_BLOCK_RANGE",
    message,
    retryable: false,
    ...(cause === undefined ? {} : { cause }),
  });
}

export function unsupportedChain(message: string, chainId?: number | null): EvmDataError {
  return new EvmDataError({
    code: "UNSUPPORTED_CHAIN",
    message,
    retryable: false,
    chainId: chainId ?? null,
  });
}

export function invalidCursor(message: string, cause?: unknown): EvmDataError {
  return new EvmDataError({
    code: "INVALID_CURSOR",
    message,
    retryable: false,
    ...(cause === undefined ? {} : { cause }),
  });
}

export function unsupportedOperation(
  message: string,
  chainId?: number | null,
): EvmDataError {
  return new EvmDataError({
    code: "UNSUPPORTED_OPERATION",
    message,
    retryable: false,
    chainId: chainId ?? null,
  });
}
