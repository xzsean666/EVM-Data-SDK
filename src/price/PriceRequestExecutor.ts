import { randomUUID } from "node:crypto";

import type { NormalizedPriceConfiguration, ObservationCallback } from "../domain/configuration";
import { EvmDataError, isEvmDataError } from "../domain/errors";
import type { TokenPriceAggregationResult, TokenPriceProviderFailure, TokenPriceProviderFailureCode, TokenPriceProviderResult } from "../domain/priceModels";
import type { NormalizedTokenPriceRequest } from "../domain/priceOperations";
import { ProxyPool } from "../execution/ProxyPool";
import type { Clock, WaitFunction } from "../execution/clock";
import { systemClock, systemWait } from "../execution/clock";
import type { ManagedProxyRoute } from "../proxy/SingBoxProxyManager";
import { isHttpTransportError } from "../transport/HttpTransport";
import type { TokenPriceProviderAdapter } from "./TokenPriceProviderAdapter";

const MAX_PROVIDER_ATTEMPTS = 3;
const RETRYABLE_CODES = new Set<TokenPriceProviderFailureCode>([
  "RATE_LIMITED",
  "REQUEST_TIMEOUT",
  "NETWORK_ERROR",
  "PROXY_ERROR",
  "PROVIDER_UNAVAILABLE",
]);

export interface PriceRequestExecutorOptions {
  readonly configuration: NormalizedPriceConfiguration;
  readonly proxies: readonly { readonly url: string }[];
  /** Optional managed loopback proxy route used only by proxy-only requests. */
  readonly advancedProxyRoute?: ManagedProxyRoute;
  readonly clock?: Clock;
  readonly wait?: WaitFunction;
  readonly observe?: ObservationCallback;
  readonly correlationIdFactory?: () => string;
}

export class PriceRequestExecutor {
  private readonly proxyPool: ProxyPool | null;
  private readonly clock: Clock;
  private readonly wait: WaitFunction;
  private readonly correlationIdFactory: () => string;
  private readonly advancedProxyRoute: ManagedProxyRoute | undefined;

  constructor(private readonly options: PriceRequestExecutorOptions) {
    this.proxyPool = options.configuration.routeMode === "proxy-only"
      ? new ProxyPool(options.proxies, { allowDirect: false })
      : null;
    this.advancedProxyRoute = options.advancedProxyRoute;
    this.clock = options.clock ?? systemClock;
    this.wait = options.wait ?? systemWait;
    this.correlationIdFactory = options.correlationIdFactory ?? randomUUID;
  }

  async execute(
    request: NormalizedTokenPriceRequest,
    adapters: readonly TokenPriceProviderAdapter[],
  ): Promise<TokenPriceAggregationResult> {
    if (this.options.configuration.routeMode === "proxy-only") this.advancedProxyRoute?.assertReady();
    if (request.signal !== undefined && request.signal.aborted) {
      throw callerAborted();
    }
    if (this.options.configuration.routeMode === "proxy-only" && this.options.proxies.length === 0 && this.advancedProxyRoute === undefined) {
      throw new EvmDataError({
        code: "PROXY_ERROR",
        message: "Token price proxy-only mode requires a configured HTTP(S) proxy.",
        retryable: false,
      });
    }
    const deadline = this.clock.now() + this.options.configuration.totalTimeoutMs;
    const maximumConcurrency = this.options.configuration.routeMode === "proxy-only"
      ? Math.min(this.options.configuration.maxProviderConcurrency, Math.max(1, this.options.proxies.length + (this.advancedProxyRoute === undefined ? 0 : 1)))
      : this.options.configuration.maxProviderConcurrency;
    const settled = await runBounded(
      adapters,
      maximumConcurrency,
      async (adapter) => this.executeProvider(adapter, request, deadline),
    );
    if (request.signal?.aborted === true) {
      throw callerAborted();
    }

    const results: TokenPriceProviderResult[] = [];
    const failures: TokenPriceProviderFailure[] = [];
    settled.forEach((outcome, index) => {
      const adapter = adapters[index];
      if (adapter === undefined) return;
      if (outcome.status === "fulfilled") {
        results.push(outcome.value);
      } else {
        failures.push(toProviderFailure(adapter.name, outcome.reason));
      }
    });

    if (results.length === 0) {
      const summary = failures.map((failure) => `${failure.provider}:${failure.code}`).join(", ");
      throw new EvmDataError({
        code: "PRICE_DATA_UNAVAILABLE",
        message: summary === "" ? "Price data is unavailable." : `Price data is unavailable (${summary}).`,
        retryable: failures.some((failure) => failure.retryable),
      });
    }

    return Object.freeze({
      query: Object.freeze({
        tokenInput: request.tokenInput,
        normalizedToken: request.normalizedToken,
        interval: "1d",
        timezone: "UTC",
        range: request.range,
        resolvedStartDate: request.resolvedRange.startDate,
        resolvedEndDate: request.resolvedRange.endDate,
      }),
      results: Object.freeze(results),
      failures: Object.freeze(failures),
      summary: Object.freeze({
        requestedProviders: adapters.length,
        succeededProviders: results.length,
        failedProviders: failures.length,
        partial: failures.length > 0,
      }),
    });
  }

  private async executeProvider(
    adapter: TokenPriceProviderAdapter,
    request: NormalizedTokenPriceRequest,
    deadline: number,
  ): Promise<TokenPriceProviderResult> {
    let lastFailure: EvmDataError | null = null;
    for (let attempt = 1; attempt <= MAX_PROVIDER_ATTEMPTS; attempt += 1) {
      if (request.signal?.aborted === true) throw callerAborted(adapter.name);
      const remaining = deadline - this.clock.now();
      if (remaining <= 0) {
        throw new EvmDataError({ code: "REQUEST_TIMEOUT", message: "Token price request exceeded its deadline.", retryable: true, provider: adapter.name });
      }
      const proxy = this.options.configuration.routeMode === "direct"
        ? null
        : await this.acquireProxy(request.signal);
      if (proxy === undefined) {
        throw new EvmDataError({ code: "PROXY_ERROR", message: "No configured proxy route is available for token prices.", retryable: false, provider: adapter.name });
      }
      const startedAt = this.clock.now();
      try {
        const result = await adapter.getPriceHistory(request, {
          proxy,
          timeoutMs: Math.max(1, Math.min(this.options.configuration.attemptTimeoutMs, remaining)),
          ...(request.signal === undefined ? {} : { signal: request.signal }),
          correlationId: this.correlationIdFactory(),
          nowMs: startedAt,
        });
        if (proxy !== null && proxy !== undefined) this.reportProxy(proxy, "success");
        this.observe(request, adapter.name, attempt, startedAt, "success");
        return result;
      } catch (error: unknown) {
        const failure = normalizeAttemptFailure(error, adapter.name, request.signal);
        lastFailure = failure;
        if (proxy !== null && proxy !== undefined) {
          this.reportProxy(proxy, failure.code === "PROXY_ERROR" ? "proxy_failure" : "neutral");
        }
        this.observe(request, adapter.name, attempt, startedAt, "failure", failure.code);
        if (failure.code === "REQUEST_ABORTED") throw failure;
        if (!RETRYABLE_CODES.has(failure.code as TokenPriceProviderFailureCode) || !failure.retryable || attempt === MAX_PROVIDER_ATTEMPTS) {
          throw failure;
        }
        const retryDelay = Math.min(
          Math.max(0, failure.retryAfterMs ?? 0, 100 * (2 ** (attempt - 1))),
          Math.max(0, deadline - this.clock.now()),
        );
        if (retryDelay <= 0 || this.clock.now() + retryDelay >= deadline) throw failure;
        await this.wait(retryDelay, request.signal);
      }
    }
    throw lastFailure ?? new EvmDataError({ code: "PROVIDER_UNAVAILABLE", message: "Token price provider did not complete.", retryable: true, provider: adapter.name });
  }

  private async acquireProxy(signal: AbortSignal | undefined) {
    const lease = this.proxyPool?.acquire();
    if (lease !== undefined) return lease;
    return this.advancedProxyRoute?.acquire(signal);
  }

  private reportProxy(proxy: NonNullable<ReturnType<ProxyPool["acquire"]>>, outcome: "success" | "proxy_failure" | "neutral"): void {
    this.proxyPool?.report(proxy, outcome);
    this.advancedProxyRoute?.report(proxy, outcome);
  }

  private observe(
    request: NormalizedTokenPriceRequest,
    provider: string,
    attempt: number,
    startedAt: number,
    outcome: "success" | "failure",
    errorCode?: string,
  ): void {
    const event = {
      operation: request.operation,
      chainId: null,
      provider,
      attempt,
      durationMs: Math.max(0, this.clock.now() - startedAt),
      outcome,
      ...(errorCode === undefined ? {} : { errorCode }),
    } as const;
    this.options.observe?.(event);
  }
}

function normalizeAttemptFailure(error: unknown, provider: string, signal: AbortSignal | undefined): EvmDataError {
  if (signal?.aborted === true) return callerAborted(provider);
  if (isEvmDataError(error)) return error;
  if (isHttpTransportError(error)) {
    return new EvmDataError({ code: error.code, message: "Token price HTTP request failed.", retryable: error.retryable, provider });
  }
  return new EvmDataError({ code: "PROVIDER_UNAVAILABLE", message: "Token price provider request failed.", retryable: true, provider });
}

function toProviderFailure(provider: TokenPriceProviderFailure["provider"], error: unknown): TokenPriceProviderFailure {
  const normalized = normalizeAttemptFailure(error, provider, undefined);
  const code: TokenPriceProviderFailureCode = isProviderFailureCode(normalized.code)
    ? normalized.code
    : "PROVIDER_UNAVAILABLE";
  return Object.freeze({
    provider,
    code,
    retryable: normalized.retryable,
    // Provider adapters classify the upstream reason into this stable code. Do
    // not copy an arbitrary upstream/custom-adapter message into a partial
    // result: it can contain a full URL, proxy userinfo, or response excerpt.
    message: providerFailureMessage(code),
  });
}

function isProviderFailureCode(value: string): value is TokenPriceProviderFailureCode {
  return value === "TOKEN_NOT_FOUND" || value === "TOKEN_AMBIGUOUS" || value === "MARKET_NOT_FOUND" || value === "HISTORY_NOT_AVAILABLE" || value === "RATE_LIMITED" || value === "REQUEST_TIMEOUT" || value === "NETWORK_ERROR" || value === "PROXY_ERROR" || value === "INVALID_PROVIDER_RESPONSE" || value === "PROVIDER_UNAVAILABLE";
}

function callerAborted(provider?: string): EvmDataError {
  return new EvmDataError({ code: "REQUEST_ABORTED", message: "Token price request was aborted.", retryable: false, ...(provider === undefined ? {} : { provider }) });
}

function providerFailureMessage(code: TokenPriceProviderFailureCode): string {
  switch (code) {
    case "TOKEN_NOT_FOUND": return "The token was not found by this provider.";
    case "TOKEN_AMBIGUOUS": return "The token could not be resolved unambiguously by this provider.";
    case "MARKET_NOT_FOUND": return "The required active Spot market was not found by this provider.";
    case "HISTORY_NOT_AVAILABLE": return "The requested daily history is not available from this provider.";
    case "RATE_LIMITED": return "The provider rate limit was reached.";
    case "REQUEST_TIMEOUT": return "The provider request timed out.";
    case "NETWORK_ERROR": return "The provider network request failed.";
    case "PROXY_ERROR": return "The configured proxy route failed.";
    case "INVALID_PROVIDER_RESPONSE": return "The provider returned an invalid response.";
    case "PROVIDER_UNAVAILABLE": return "The provider is temporarily unavailable.";
  }
}

async function runBounded<T, R>(
  values: readonly T[],
  concurrency: number,
  operation: (value: T) => Promise<R>,
): Promise<readonly PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(values.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = next;
      next += 1;
      const value = values[index];
      if (value === undefined) return;
      try {
        results[index] = { status: "fulfilled", value: await operation(value) };
      } catch (reason: unknown) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, values.length)) }, worker));
  return results;
}
