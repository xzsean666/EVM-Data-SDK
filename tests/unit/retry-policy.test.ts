import { describe, expect, it } from "vitest";

import { EvmDataError } from "../../src/domain/errors";
import { RetryPolicy } from "../../src/execution/RetryPolicy";

function failure(
  code: ConstructorParameters<typeof EvmDataError>[0]["code"],
  options: Partial<ConstructorParameters<typeof EvmDataError>[0]> = {},
): EvmDataError {
  return new EvmDataError({
    code,
    message: code,
    retryable: true,
    ...options,
  });
}

describe("RetryPolicy", () => {
  it("rotates credentials for authentication failures and never falls back on continuation", () => {
    const policy = new RetryPolicy();
    expect(policy.decide({
      error: failure("AUTHENTICATION_FAILED", { retryable: false }),
      attempt: 1,
      maxTotalAttempts: 6,
      continuation: false,
      hasAlternativeCredential: true,
      hasAlternativeProxy: false,
      hasAlternativeProvider: true,
      remainingMs: 10_000,
      randomValue: 0,
    })).toMatchObject({ action: "rotate_credential", delayMs: 0 });
    expect(policy.decide({
      error: failure("AUTHENTICATION_FAILED", { retryable: false }),
      attempt: 1,
      maxTotalAttempts: 6,
      continuation: true,
      hasAlternativeCredential: false,
      hasAlternativeProxy: false,
      hasAlternativeProvider: false,
      remainingMs: 10_000,
      randomValue: 0,
    }).action).toBe("stop");
  });

  it("honors Retry-After and applies deterministic jitter to transient retries", () => {
    const policy = new RetryPolicy({ initialBackoffMs: 100, maxBackoffMs: 1_000 });
    const rate = policy.decide({
      error: failure("RATE_LIMITED", { retryAfterMs: 300 }),
      attempt: 1,
      maxTotalAttempts: 6,
      continuation: true,
      hasAlternativeCredential: false,
      hasAlternativeProxy: false,
      hasAlternativeProvider: false,
      remainingMs: 10_000,
      randomValue: 0.1,
    });
    expect(rate).toMatchObject({ action: "retry", delayMs: 300 });

    const transient = policy.decide({
      error: failure("NETWORK_ERROR"),
      attempt: 2,
      maxTotalAttempts: 6,
      continuation: true,
      hasAlternativeCredential: false,
      hasAlternativeProxy: false,
      hasAlternativeProvider: false,
      remainingMs: 10_000,
      randomValue: 0.5,
    });
    expect(transient).toMatchObject({ action: "retry", delayMs: 100 });
  });

  it("falls back for permanent provider payload/plan failures and proxy exhaustion", () => {
    const policy = new RetryPolicy();
    for (const code of ["INVALID_PROVIDER_RESPONSE", "PLAN_RESTRICTED"] as const) {
      expect(policy.decide({
        error: failure(code, { retryable: false }),
        attempt: 1,
        maxTotalAttempts: 6,
        continuation: false,
        hasAlternativeCredential: false,
        hasAlternativeProxy: false,
        hasAlternativeProvider: true,
        remainingMs: 10_000,
        randomValue: 0,
      }).action).toBe("fallback_provider");
    }
    expect(policy.decide({
      error: failure("PROXY_ERROR"),
      attempt: 1,
      maxTotalAttempts: 6,
      continuation: false,
      hasAlternativeCredential: false,
      hasAlternativeProxy: false,
      hasAlternativeProvider: true,
      remainingMs: 10_000,
      randomValue: 0,
    }).action).toBe("fallback_provider");
  });

  it("stops at cancellation, deadline, and total attempt limits", () => {
    const policy = new RetryPolicy();
    const base = {
      attempt: 1,
      maxTotalAttempts: 2,
      continuation: false,
      hasAlternativeCredential: false,
      hasAlternativeProxy: false,
      hasAlternativeProvider: true,
      remainingMs: 10_000,
      randomValue: 0,
    } as const;
    expect(policy.decide({ ...base, error: failure("REQUEST_ABORTED", { retryable: false }) }).action).toBe("stop");
    expect(policy.decide({ ...base, remainingMs: 0, error: failure("NETWORK_ERROR") }).action).toBe("stop");
    expect(policy.decide({ ...base, attempt: 2, error: failure("NETWORK_ERROR") }).action).toBe("stop");
  });
});
