import type { ErrorCode, EvmDataError } from "../domain/errors";

export type RetryAction =
  | "stop"
  | "retry"
  | "rotate_credential"
  | "rotate_proxy"
  | "fallback_provider";

export interface RetryPolicyOptions {
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
}

export interface RetryDecisionInput {
  readonly error: Pick<EvmDataError, "code" | "retryable" | "retryAfterMs">;
  readonly attempt: number;
  readonly maxTotalAttempts: number;
  readonly continuation: boolean;
  readonly hasAlternativeCredential: boolean;
  readonly hasAlternativeProxy: boolean;
  readonly hasAlternativeProvider: boolean;
  readonly remainingMs: number;
  readonly randomValue: number;
}

export interface RetryDecision {
  readonly action: RetryAction;
  readonly delayMs: number;
  readonly reason: string;
}

const defaultRetryableCodes = new Set<ErrorCode>([
  "RATE_LIMITED",
  "REQUEST_TIMEOUT",
  "NETWORK_ERROR",
  "PROXY_ERROR",
  "PROVIDER_UNAVAILABLE",
]);

export class RetryPolicy {
  private readonly initialBackoffMs: number;
  private readonly maxBackoffMs: number;

  constructor(options: RetryPolicyOptions = {}) {
    this.initialBackoffMs = validateDelay(options.initialBackoffMs ?? 250);
    this.maxBackoffMs = validateDelay(options.maxBackoffMs ?? 10_000);
    if (this.maxBackoffMs < this.initialBackoffMs) {
      throw new Error("maxBackoffMs must be at least initialBackoffMs.");
    }
  }

  decide(input: RetryDecisionInput): RetryDecision {
    if (input.remainingMs <= 0) {
      return stop("overall deadline exhausted");
    }
    if (input.attempt >= input.maxTotalAttempts) {
      return stop("total attempt budget exhausted");
    }

    switch (input.error.code) {
      case "REQUEST_ABORTED":
      case "INVALID_REQUEST":
      case "INVALID_CURSOR":
      case "UNSUPPORTED_CHAIN":
      case "UNSUPPORTED_OPERATION":
        return stop("caller or capability failure");
      case "AUTHENTICATION_FAILED":
        if (input.hasAlternativeCredential) {
          return immediate("rotate_credential", "credential rejected");
        }
        return input.hasAlternativeProvider && !input.continuation
          ? immediate("fallback_provider", "no usable credential remains")
          : stop("no usable credential remains");
      case "PLAN_RESTRICTED":
        return input.hasAlternativeProvider && !input.continuation
          ? immediate("fallback_provider", "provider plan restriction")
          : stop("provider plan restriction");
      case "INVALID_PROVIDER_RESPONSE":
        return input.hasAlternativeProvider && !input.continuation
          ? immediate("fallback_provider", "provider payload failed validation")
          : stop("provider payload failed validation");
      case "PROXY_ERROR":
        if (input.hasAlternativeProxy) {
          return immediate("rotate_proxy", "proxy boundary failure");
        }
        if (input.hasAlternativeProvider && !input.continuation) {
          return immediate("fallback_provider", "no proxy route remains");
        }
        return stop("no proxy route remains");
      case "RATE_LIMITED":
        if (input.hasAlternativeCredential) {
          return immediate("rotate_credential", "rate limit with another credential available");
        }
        if (input.hasAlternativeProvider && !input.continuation && input.attempt + 1 >= input.maxTotalAttempts) {
          return immediate("fallback_provider", "preserve the final attempt for another provider");
        }
        return input.error.retryable
          ? retry(this.delayFor(input), "rate limited")
          : input.hasAlternativeProvider && !input.continuation
            ? immediate("fallback_provider", "rate limit is not retryable")
            : stop("rate limit is not retryable");
      default:
        if (defaultRetryableCodes.has(input.error.code) && input.error.retryable) {
          if (input.hasAlternativeProvider && !input.continuation && input.attempt + 1 >= input.maxTotalAttempts) {
            return immediate("fallback_provider", "preserve the final attempt for another provider");
          }
          return retry(this.delayFor(input), "transient provider failure");
        }
        return input.hasAlternativeProvider && !input.continuation
          ? immediate("fallback_provider", "non-retryable provider failure")
          : stop("non-retryable provider failure");
    }
  }

  private delayFor(input: RetryDecisionInput): number {
    const exponent = Math.min(Math.max(input.attempt - 1, 0), 30);
    const exponential = Math.min(this.maxBackoffMs, this.initialBackoffMs * (2 ** exponent));
    const random = Math.min(1, Math.max(0, Number.isFinite(input.randomValue) ? input.randomValue : 0));
    const jittered = Math.floor(exponential * random);
    const retryAfter = input.error.retryAfterMs === null || input.error.retryAfterMs === undefined
      ? 0
      : Math.max(0, input.error.retryAfterMs);
    return Math.max(jittered, retryAfter);
  }
}

function immediate(action: Exclude<RetryAction, "retry" | "stop">, reason: string): RetryDecision {
  return { action, delayMs: 0, reason };
}

function retry(delayMs: number, reason: string): RetryDecision {
  return { action: "retry", delayMs, reason };
}

function stop(reason: string): RetryDecision {
  return { action: "stop", delayMs: 0, reason };
}

function validateDelay(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 86_400_000) {
    throw new Error("Retry delay must be a non-negative bounded integer.");
  }
  return value;
}
