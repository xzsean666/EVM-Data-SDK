import { randomUUID } from "node:crypto";

import type { NormalizedRequestPolicy, ObservationCallback } from "../domain/configuration";
import type { OperationName } from "../domain/operations";
import {
  EvmDataError,
  type ErrorCode,
} from "../domain/errors";
import type { NormalizedProviderRequest, ProviderAttemptContext } from "../providers/DataProviderAdapter";
import type {
  CredentialLease,
  DataProviderAdapter,
  ProviderBlockRangeWindowResult,
  ProxyLease,
} from "../providers/DataProviderAdapter";
import type { Erc20Transfer, NativeBalance, Page, Transaction } from "../domain/models";
import type { ProviderPageResult } from "../domain/pagination";
import { decodeCursor, encodeCursor, queryFingerprint } from "./cursorCodec";
import { CredentialPool } from "./CredentialPool";
import type { Clock, RandomSource, WaitFunction } from "./clock";
import { systemClock, systemRandom, systemWait } from "./clock";
import { ProviderRouter, type ProviderCandidate } from "./ProviderRouter";
import { RetryPolicy } from "./RetryPolicy";
import { ProxyPool } from "./ProxyPool";
import { isHttpTransportError } from "../transport/HttpTransport";
import { redactMessage } from "../transport/redaction";
import { isEvmDataError } from "../domain/errors";
import type { ManagedProxyRoute } from "../proxy/SingBoxProxyManager";

export interface RequestExecutorOptions {
  readonly router: ProviderRouter;
  readonly requestPolicy: NormalizedRequestPolicy;
  readonly credentialPools?: ReadonlyMap<string, CredentialPool> | Readonly<Record<string, CredentialPool>>;
  readonly proxyPool?: ProxyPool;
  /** One optional managed loopback HTTP route for advanced proxies. */
  readonly advancedProxyRoute?: ManagedProxyRoute;
  readonly retryPolicy?: RetryPolicy;
  readonly clock?: Clock;
  readonly random?: RandomSource;
  readonly wait?: WaitFunction;
  readonly observe?: ObservationCallback;
  readonly correlationIdFactory?: () => string;
}

type ExecutorResult = Page<Transaction> | NativeBalance | Page<Erc20Transfer>;
type MappedProviderResult = ExecutorResult | ProviderBlockRangeWindowResult;

export interface BlockRangeWindowExecution {
  readonly result: ProviderBlockRangeWindowResult;
  readonly upstreamRequests: number;
}

const PROVIDER_FAILURE_THRESHOLD = 2;
const PROVIDER_COOLDOWN_MS = 1_000;
const providerHealthCodes = new Set<ErrorCode>([
  "NETWORK_ERROR",
  "REQUEST_TIMEOUT",
  "PROVIDER_UNAVAILABLE",
  "RATE_LIMITED",
  "PLAN_RESTRICTED",
]);

interface ProviderHealthState {
  failureCount: number;
  cooldownUntil: number | null;
  cooldownExecutionId: number | null;
}

export class RequestExecutor {
  private readonly router: ProviderRouter;
  private readonly requestPolicy: NormalizedRequestPolicy;
  private readonly credentialPools: ReadonlyMap<string, CredentialPool> | Readonly<Record<string, CredentialPool>>;
  private readonly proxyPool: ProxyPool;
  private readonly advancedProxyRoute: ManagedProxyRoute | undefined;
  private readonly retryPolicy: RetryPolicy;
  private readonly clock: Clock;
  private readonly random: RandomSource;
  private readonly wait: WaitFunction;
  private readonly observe: ObservationCallback | undefined;
  private readonly correlationIdFactory: () => string;
  private readonly lastAttemptAt = new Map<string, number>();
  private readonly providerHealth = new Map<string, ProviderHealthState>();
  private nextExecutionId = 0;

  constructor(options: RequestExecutorOptions) {
    this.router = options.router;
    this.requestPolicy = options.requestPolicy;
    this.credentialPools = options.credentialPools ?? new Map();
    this.proxyPool = options.proxyPool ?? new ProxyPool([], { allowDirect: options.requestPolicy.allowDirect });
    this.advancedProxyRoute = options.advancedProxyRoute;
    this.retryPolicy = options.retryPolicy ?? new RetryPolicy();
    this.clock = options.clock ?? systemClock;
    this.random = options.random ?? systemRandom;
    this.wait = options.wait ?? systemWait;
    this.observe = options.observe;
    this.correlationIdFactory = options.correlationIdFactory ?? randomUUID;
  }

  execute(request: import("../domain/operations").NormalizedTransactionsRequest): Promise<Page<Transaction>>;
  execute(request: import("../domain/operations").NormalizedNativeBalanceRequest): Promise<NativeBalance>;
  execute(request: import("../domain/operations").NormalizedErc20TransfersRequest): Promise<Page<Erc20Transfer>>;
  execute(
    request: import("../domain/operations").NormalizedErc20BlockRangeRequest,
    providerOffset?: number,
  ): Promise<BlockRangeWindowExecution>;
  async execute(
    request: NormalizedProviderRequest,
    providerOffset = 0,
  ): Promise<ExecutorResult | BlockRangeWindowExecution> {
    this.advancedProxyRoute?.assertReady();
    if (request.signal?.aborted === true) {
      throw callerAborted();
    }
    const cursorValue = "cursor" in request ? request.cursor : null;
    const identity = cursorValue === null ? null : decodeCursor(cursorValue);
    const routedCandidates = identity === null
      ? this.router.route(request)
      : [this.router.routeContinuation(request, identity)];
    const candidates = request.operation === "getErc20TransfersByBlockRange"
      ? rotateCandidates(routedCandidates, providerOffset)
      : routedCandidates;
    const deadline = this.clock.now() + this.requestPolicy.totalTimeoutMs;
    const executionId = ++this.nextExecutionId;
    const continuation = identity !== null;
    const providerPageState = identity?.providerPageState ?? null;
    let candidateIndex = 0;
    let attempt = 0;
    let lastFailure: EvmDataError | null = null;

    while (candidateIndex < candidates.length) {
      const candidate = candidates[candidateIndex];
      if (candidate === undefined) {
        break;
      }
      let useNextCandidate = false;

      while (attempt < this.requestPolicy.maxTotalAttempts) {
        const remainingBeforeAttempt = this.ensureBudget(deadline, request);
        const healthWaitMs = this.providerHealthWait(candidate, request.operation, this.clock.now(), executionId);
        if (healthWaitMs !== null) {
          if (!continuation && candidateIndex + 1 < candidates.length) {
            candidateIndex += 1;
            useNextCandidate = true;
            break;
          }
          await this.waitWithinBudget(healthWaitMs, deadline, request.signal);
        }
        await this.pace(candidate.adapter.name, deadline, request.signal);

        const credentialPool = this.getCredentialPool(candidate.configurationId);
        const credential = await this.acquireCredential(
          credentialPool,
          deadline,
          request.signal,
          continuation || candidateIndex + 1 >= candidates.length,
        );
        if (credentialPool !== null && credential === null) {
          if (
            !continuation &&
            candidateIndex + 1 < candidates.length &&
            credentialPool.nextAvailableAt() !== null
          ) {
            candidateIndex += 1;
            useNextCandidate = true;
            break;
          }
          const failure = this.poolUnavailableFailure(candidate, credentialPool);
          lastFailure = failure;
          const decision = this.retryPolicy.decide({
            error: failure,
            attempt,
            maxTotalAttempts: this.requestPolicy.maxTotalAttempts,
            continuation,
            hasAlternativeCredential: false,
            hasAlternativeProxy: this.hasAvailableProxy(),
            hasAlternativeProvider: !continuation && candidateIndex + 1 < candidates.length,
            remainingMs: remainingBeforeAttempt,
            randomValue: this.random.next(),
          });
          if (decision.action === "fallback_provider") {
            candidateIndex += 1;
            useNextCandidate = true;
            break;
          }
          if (decision.action === "retry") {
            await this.waitWithinBudget(decision.delayMs, deadline, request.signal);
            continue;
          }
          throw failure;
        }

        if (
          !continuation &&
          candidateIndex + 1 < candidates.length &&
          !this.hasAvailableProxy() &&
          this.proxyPool.nextAvailableAt() !== null
        ) {
          candidateIndex += 1;
          useNextCandidate = true;
          break;
        }
        const proxy = await this.acquireProxy(deadline, request.signal);
        if (proxy === undefined) {
          if (credential !== null) {
            credentialPool?.report(credential, "neutral");
          }
          const failure = new EvmDataError({
            code: "PROXY_ERROR",
            message: "No configured proxy route is currently available.",
            retryable: true,
            provider: candidate.adapter.name,
            chainId: candidate.chain.chainId,
          });
          lastFailure = failure;
          const decision = this.retryPolicy.decide({
            error: failure,
            attempt,
            maxTotalAttempts: this.requestPolicy.maxTotalAttempts,
            continuation,
            hasAlternativeCredential: credentialPool?.hasAvailable() ?? false,
            hasAlternativeProxy: false,
            hasAlternativeProvider: !continuation && candidateIndex + 1 < candidates.length,
            remainingMs: remainingBeforeAttempt,
            randomValue: this.random.next(),
          });
          if (decision.action === "fallback_provider") {
            candidateIndex += 1;
            useNextCandidate = true;
            break;
          }
          if (decision.action === "retry") {
            await this.waitWithinBudget(decision.delayMs, deadline, request.signal);
            continue;
          }
          throw failure;
        }

        attempt += 1;
        const startedAt = this.clock.now();
        const remainingForAttempt = this.ensureBudget(deadline, request);
        const timeoutMs = Math.max(1, Math.min(this.requestPolicy.attemptTimeoutMs, remainingForAttempt));
        const context: ProviderAttemptContext = {
          chain: candidate.chain,
          credential,
          proxy,
          timeoutMs,
          ...(request.signal === undefined ? {} : { signal: request.signal }),
          ...(providerPageState === null ? { providerPageState: null } : { providerPageState }),
          correlationId: this.correlationIdFactory(),
        };

        try {
          const raw = await invokeAdapter(candidate.adapter, request, context);
          const mapped = mapSuccess(raw, candidate, request, queryFingerprint(request, candidate.chain.chainId));
          if (credentialPool !== null && credential !== null) {
            credentialPool.report(credential, "success");
          }
          if (proxy !== null) {
            this.reportProxy(proxy, "success");
          }
          this.recordProviderSuccess(candidate, request.operation);
          this.observeAttempt(request, candidate, attempt, startedAt, "success");
          if (request.operation === "getErc20TransfersByBlockRange") {
            if (!isProviderBlockRangeWindowResult(mapped)) {
              throw invalidProviderResponse(candidate);
            }
            const result = mapped;
            if (!result.complete && candidateIndex + 1 < candidates.length && attempt < this.requestPolicy.maxTotalAttempts) {
              candidateIndex += 1;
              useNextCandidate = true;
              break;
            }
            return { result, upstreamRequests: attempt };
          }
          return mapped as ExecutorResult;
        } catch (error: unknown) {
          const failure = request.signal !== undefined && request.signal.aborted
            ? callerAborted(candidate)
            : normalizeFailure(error, candidate, context, request);
          lastFailure = failure;
          if (credentialPool !== null && credential !== null) {
            credentialPool.report(credential, credentialOutcome(failure));
          }
          if (proxy !== null) {
            this.reportProxy(proxy, failure.code === "PROXY_ERROR" ? "proxy_failure" : "neutral");
          }
          this.recordProviderOutcome(candidate, request.operation, failure, executionId);
          this.observeAttempt(request, candidate, attempt, startedAt, "failure", failure.code);
          if (failure.code === "REQUEST_ABORTED") {
            throw failure;
          }

          const decision = this.retryPolicy.decide({
            error: failure,
            attempt,
            maxTotalAttempts: this.requestPolicy.maxTotalAttempts,
            continuation,
            hasAlternativeCredential: credentialPool?.hasAvailable() ?? false,
            hasAlternativeProxy: this.hasAvailableProxy(),
            hasAlternativeProvider: !continuation && candidateIndex + 1 < candidates.length,
            remainingMs: Math.max(0, deadline - this.clock.now()),
            randomValue: this.random.next(),
          });
          if (decision.action === "fallback_provider") {
            candidateIndex += 1;
            useNextCandidate = true;
            break;
          }
          if (decision.action === "retry" || decision.action === "rotate_credential" || decision.action === "rotate_proxy") {
            await this.waitWithinBudget(decision.delayMs, deadline, request.signal);
            continue;
          }
          throw failure;
        }
      }

      if (useNextCandidate) {
        continue;
      }
      if (attempt >= this.requestPolicy.maxTotalAttempts) {
        break;
      }
      candidateIndex += 1;
    }

    if (lastFailure !== null) {
      throw lastFailure;
    }
    throw new EvmDataError({
      code: "PROVIDER_UNAVAILABLE",
      message: "No provider attempt completed.",
      retryable: false,
    });
  }

  private getCredentialPool(configurationId: string): CredentialPool | null {
    const map = this.credentialPools as ReadonlyMap<string, CredentialPool>;
    if (typeof map.get === "function") {
      return map.get(configurationId) ?? null;
    }
    return (this.credentialPools as Readonly<Record<string, CredentialPool>>)[configurationId] ?? null;
  }

  private async acquireCredential(
    pool: CredentialPool | null,
    deadline: number,
    signal: AbortSignal | undefined,
    waitForCooldown: boolean,
  ): Promise<CredentialLease | null> {
    if (pool === null) {
      return null;
    }
    while (true) {
      const now = this.ensureSignalAndDeadline(deadline, signal);
      const lease = pool.acquire(now);
      if (lease !== null) {
        return lease;
      }
      if (pool.isExhausted(now)) {
        return null;
      }
      const next = pool.nextAvailableAt(now);
      if (next === null) {
        return null;
      }
      if (!waitForCooldown) {
        return null;
      }
      await this.waitWithinBudget(next - now, deadline, signal);
    }
  }

  private async acquireProxy(
    deadline: number,
    signal: AbortSignal | undefined,
  ): Promise<ProxyLease | null | undefined> {
    while (true) {
      const now = this.ensureSignalAndDeadline(deadline, signal);
      const preferManaged = this.advancedProxyRoute !== undefined && this.nextAdvancedProxy();
      if (preferManaged) {
        return this.acquireManagedProxy(deadline, signal);
      }
      const lease = this.proxyPool.acquire(now);
      if (lease !== undefined) {
        return lease;
      }
      if (this.advancedProxyRoute !== undefined) {
        return this.acquireManagedProxy(deadline, signal);
      }
      if (this.proxyPool.isExhausted(now)) {
        return undefined;
      }
      const next = this.proxyPool.nextAvailableAt(now);
      if (next === null) {
        return undefined;
      }
      await this.waitWithinBudget(next - now, deadline, signal);
    }
  }

  private advancedProxySequence = false;

  private nextAdvancedProxy(): boolean {
    this.advancedProxySequence = !this.advancedProxySequence;
    return this.advancedProxySequence;
  }

  private hasAvailableProxy(): boolean {
    return this.proxyPool.hasAvailable() || this.advancedProxyRoute !== undefined;
  }

  private async acquireManagedProxy(deadline: number, signal: AbortSignal | undefined): Promise<ProxyLease> {
    const route = this.advancedProxyRoute;
    if (route === undefined) {
      throw new EvmDataError({ code: "PROXY_ERROR", message: "No managed proxy route is configured.", retryable: false });
    }
    const remaining = this.ensureSignalAndDeadline(deadline, signal);
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    signal?.addEventListener("abort", forwardAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), remaining);
    try {
      return await route.acquire(controller.signal);
    } catch (error: unknown) {
      if (signal?.aborted === true) throw callerAborted();
      if (controller.signal.aborted === true) {
        throw new EvmDataError({
          code: "REQUEST_TIMEOUT",
          message: "Overall request deadline exceeded while preparing the managed proxy.",
          retryable: false,
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", forwardAbort);
    }
  }

  private reportProxy(lease: ProxyLease, outcome: "success" | "proxy_failure" | "neutral"): void {
    this.proxyPool.report(lease, outcome);
    this.advancedProxyRoute?.report(lease, outcome);
  }

  private async pace(provider: string, deadline: number, signal: AbortSignal | undefined): Promise<void> {
    const interval = this.requestPolicy.providerPacingMs[provider.trim().toLowerCase()] ?? 0;
    if (interval <= 0) {
      this.ensureSignalAndDeadline(deadline, signal);
      return;
    }
    const previous = this.lastAttemptAt.get(provider);
    if (previous !== undefined) {
      const waitMs = interval - (this.clock.now() - previous);
      if (waitMs > 0) {
        await this.waitWithinBudget(waitMs, deadline, signal);
      }
    }
    this.lastAttemptAt.set(provider, this.clock.now());
  }

  private async waitWithinBudget(
    delayMs: number,
    deadline: number,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    const remaining = this.ensureSignalAndDeadline(deadline, signal);
    if (delayMs <= 0) {
      return;
    }
    try {
      await this.wait(Math.min(delayMs, remaining), signal);
    } catch (error: unknown) {
      if (signal?.aborted === true || error instanceof Error && error.name === "AbortError") {
        throw callerAborted();
      }
      throw error;
    }
    this.ensureSignalAndDeadline(deadline, signal);
  }

  private ensureBudget(deadline: number, request: NormalizedProviderRequest): number {
    return this.ensureSignalAndDeadline(deadline, request.signal);
  }

  private ensureSignalAndDeadline(deadline: number, signal: AbortSignal | undefined): number {
    if (signal?.aborted === true) {
      throw callerAborted();
    }
    const remaining = deadline - this.clock.now();
    if (remaining <= 0) {
      throw new EvmDataError({
        code: "REQUEST_TIMEOUT",
        message: "Overall request deadline exceeded.",
        retryable: false,
      });
    }
    return remaining;
  }

  private observeAttempt(
    request: NormalizedProviderRequest,
    candidate: ProviderCandidate,
    attempt: number,
    startedAt: number,
    outcome: "success" | "failure",
    errorCode?: ErrorCode,
  ): void {
    if (this.observe === undefined) {
      return;
    }
    try {
      this.observe({
        operation: request.operation,
        chainId: candidate.chain.chainId,
        provider: candidate.adapter.name,
        attempt,
        durationMs: Math.max(0, this.clock.now() - startedAt),
        outcome,
        ...(errorCode === undefined ? {} : { errorCode }),
      });
    } catch {
      // Observation must never change request behavior.
    }
  }

  private poolUnavailableFailure(candidate: ProviderCandidate, pool: CredentialPool): EvmDataError {
    const cooldown = pool.nextAvailableAt();
    return new EvmDataError({
      code: cooldown === null ? "AUTHENTICATION_FAILED" : "RATE_LIMITED",
      message: cooldown === null
        ? "No usable credential is available for the provider configuration."
        : "All credentials for the provider configuration are cooling down.",
      retryable: cooldown !== null,
      provider: candidate.adapter.name,
      chainId: candidate.chain.chainId,
      ...(cooldown === null ? {} : { retryAfterMs: Math.max(0, cooldown - this.clock.now()) }),
    });
  }

  private providerHealthWait(
    candidate: ProviderCandidate,
    operation: OperationName,
    now: number,
    executionId: number,
  ): number | null {
    const state = this.providerHealth.get(providerHealthKey(candidate, operation));
    if (state === undefined || state.cooldownUntil === null || state.cooldownUntil <= now) {
      return null;
    }
    // A failure recorded during this operation should be handled by its retry policy first.
    if (state.cooldownExecutionId === executionId) {
      return null;
    }
    return state.cooldownUntil - now;
  }

  private recordProviderOutcome(
    candidate: ProviderCandidate,
    operation: OperationName,
    failure: EvmDataError,
    executionId: number,
  ): void {
    const key = providerHealthKey(candidate, operation);
    const current = this.providerHealth.get(key) ?? {
      failureCount: 0,
      cooldownUntil: null,
      cooldownExecutionId: null,
    };
    if (!providerHealthCodes.has(failure.code)) {
      this.providerHealth.set(key, current);
      return;
    }

    current.failureCount += 1;
    const shouldCooldown = failure.code === "RATE_LIMITED" || failure.code === "PLAN_RESTRICTED"
      ? true
      : current.failureCount >= PROVIDER_FAILURE_THRESHOLD;
    if (shouldCooldown) {
      const now = this.clock.now();
      const retryAfter = failure.retryAfterMs === null ? 0 : Math.max(0, failure.retryAfterMs);
      current.cooldownUntil = now + Math.max(PROVIDER_COOLDOWN_MS, retryAfter);
      current.cooldownExecutionId = executionId;
    }
    this.providerHealth.set(key, current);
  }

  private recordProviderSuccess(candidate: ProviderCandidate, operation: OperationName): void {
    const key = providerHealthKey(candidate, operation);
    const state = this.providerHealth.get(key);
    if (state === undefined) {
      return;
    }
    state.failureCount = Math.max(0, state.failureCount - 1);
    state.cooldownUntil = null;
    state.cooldownExecutionId = null;
  }
}

function providerHealthKey(candidate: ProviderCandidate, operation: OperationName): string {
  return `${candidate.configurationId}:${candidate.chain.chainId}:${operation}`;
}

async function invokeAdapter(
  adapter: DataProviderAdapter,
  request: NormalizedProviderRequest,
  context: ProviderAttemptContext,
): Promise<ProviderPageResult<unknown> | NativeBalance | ProviderBlockRangeWindowResult> {
  switch (request.operation) {
    case "getTransactions":
      if (adapter.getTransactions === undefined) {
        throw new EvmDataError({ code: "UNSUPPORTED_OPERATION", message: "Provider method is unavailable.", retryable: false });
      }
      return adapter.getTransactions(request, context) as Promise<ProviderPageResult<unknown>>;
    case "getNativeBalance":
      if (adapter.getNativeBalance === undefined) {
        throw new EvmDataError({ code: "UNSUPPORTED_OPERATION", message: "Provider method is unavailable.", retryable: false });
      }
      return adapter.getNativeBalance(request, context);
    case "getErc20Transfers":
      if (adapter.getErc20Transfers === undefined) {
        throw new EvmDataError({ code: "UNSUPPORTED_OPERATION", message: "Provider method is unavailable.", retryable: false });
      }
      return adapter.getErc20Transfers(request, context) as Promise<ProviderPageResult<unknown>>;
    case "getErc20TransfersByBlockRange":
      if (adapter.getErc20TransfersByBlockRangeWindow === undefined) {
        throw new EvmDataError({ code: "BLOCK_RANGE_UNSUPPORTED", message: "Provider block-range method is unavailable.", retryable: false });
      }
      return adapter.getErc20TransfersByBlockRangeWindow(request, context);
  }
}

function mapSuccess(
  raw: ProviderPageResult<unknown> | NativeBalance | ProviderBlockRangeWindowResult,
  candidate: ProviderCandidate,
  request: NormalizedProviderRequest,
  fingerprint: string,
): MappedProviderResult {
  if (request.operation === "getErc20TransfersByBlockRange") {
    if (!isProviderBlockRangeWindowResult(raw) || raw.pageInfo.chainId !== candidate.chain.chainId || raw.pageInfo.provider !== candidate.adapter.name) {
      throw invalidProviderResponse(candidate);
    }
    return raw;
  }
  if (request.operation === "getNativeBalance") {
    if (!isNativeBalance(raw) || raw.chainId !== candidate.chain.chainId || raw.provider !== candidate.adapter.name) {
      throw invalidProviderResponse(candidate);
    }
    return raw;
  }
  if (!isProviderPageResult(raw) || raw.pageInfo.chainId !== candidate.chain.chainId || raw.pageInfo.provider !== candidate.adapter.name) {
    throw invalidProviderResponse(candidate);
  }

  let nextCursor: string | null = null;
  if (raw.nextPageState !== null) {
    try {
      nextCursor = encodeCursor({
        version: 1,
        operation: request.operation,
        provider: candidate.adapter.name,
        providerConfigurationId: candidate.configurationId,
        chainId: candidate.chain.chainId,
        queryFingerprint: fingerprint,
        providerPageState: raw.nextPageState,
      });
    } catch {
      throw invalidProviderResponse(candidate);
    }
  }
  return {
    items: raw.items as Transaction[] | Erc20Transfer[],
    nextCursor,
    pageInfo: raw.pageInfo,
  } as Page<Transaction> | Page<Erc20Transfer>;
}

function normalizeFailure(
  error: unknown,
  candidate: ProviderCandidate,
  context: ProviderAttemptContext,
  request: NormalizedProviderRequest,
): EvmDataError {
  const safeMessage = (message: string): string => redactMessage(message, {
    knownSecrets: [
      ...(context.credential === null ? [] : [context.credential.value]),
      ...(context.proxy === null ? [] : [context.proxy.url]),
      ...("cursor" in request && request.cursor !== null ? [request.cursor] : []),
      ...collectPageStateStrings(context.providerPageState),
    ],
  });
  if (isEvmDataError(error)) {
    if (error.provider === candidate.adapter.name && error.chainId === candidate.chain.chainId) {
      return new EvmDataError({
        code: error.code,
        message: safeMessage(error.message),
        retryable: error.retryable,
        provider: error.provider,
        chainId: error.chainId,
        retryAfterMs: error.retryAfterMs,
        ...(error.cause === undefined ? {} : { cause: error.cause }),
      });
    }
    return new EvmDataError({
      code: error.code,
      message: safeMessage(error.message),
      retryable: error.retryable,
      provider: error.provider ?? candidate.adapter.name,
      chainId: error.chainId ?? candidate.chain.chainId,
      retryAfterMs: error.retryAfterMs,
      ...(error.cause === undefined ? {} : { cause: error.cause }),
    });
  }
  if (isHttpTransportError(error)) {
    return new EvmDataError({
      code: error.code,
      message: safeMessage(error.message),
      retryable: error.retryable,
      provider: candidate.adapter.name,
      chainId: candidate.chain.chainId,
      ...(error.cause === undefined ? {} : { cause: error.cause }),
    });
  }
  return new EvmDataError({
    code: "PROVIDER_UNAVAILABLE",
    message: "Provider attempt failed.",
    retryable: true,
    provider: candidate.adapter.name,
    chainId: candidate.chain.chainId,
  });
}

function collectPageStateStrings(value: unknown): string[] {
  const values: string[] = [];
  const seen = new WeakSet<object>();

  const visit = (entry: unknown, depth: number): void => {
    if (depth > 8 || entry === null || entry === undefined) {
      return;
    }
    if (typeof entry === "string") {
      if (entry.length > 0 && entry.length <= 4096) {
        values.push(entry);
      }
      return;
    }
    if (typeof entry !== "object" || seen.has(entry)) {
      return;
    }
    seen.add(entry);
    if (Array.isArray(entry)) {
      for (const child of entry) {
        visit(child, depth + 1);
      }
    } else {
      for (const child of Object.values(entry)) {
        visit(child, depth + 1);
      }
    }
    seen.delete(entry);
  };

  visit(value, 0);
  return values;
}

function credentialOutcome(error: EvmDataError): "authentication_failed" | "rate_limited" | "neutral" | "cancelled" {
  if (error.code === "AUTHENTICATION_FAILED") {
    return "authentication_failed";
  }
  if (error.code === "RATE_LIMITED") {
    return "rate_limited";
  }
  if (error.code === "REQUEST_ABORTED") {
    return "cancelled";
  }
  return "neutral";
}

function isNativeBalance(value: ProviderPageResult<unknown> | NativeBalance | ProviderBlockRangeWindowResult): value is NativeBalance {
  return typeof value === "object" && value !== null && !("items" in value) && "chainId" in value && "provider" in value;
}

function isProviderPageResult(value: ProviderPageResult<unknown> | NativeBalance | ProviderBlockRangeWindowResult): value is ProviderPageResult<unknown> {
  return typeof value === "object" &&
    value !== null &&
    "items" in value &&
    Array.isArray(value.items) &&
    "nextPageState" in value &&
    value.nextPageState !== undefined &&
    typeof value.pageInfo === "object" &&
    value.pageInfo !== null &&
    typeof value.pageInfo.chainId === "number" &&
    typeof value.pageInfo.provider === "string";
}

function isProviderBlockRangeWindowResult(value: unknown): value is ProviderBlockRangeWindowResult {
  if (typeof value !== "object" || value === null || !("complete" in value) ||
    !("items" in value) || !("pageInfo" in value)) {
    return false;
  }
  const pageInfo = value.pageInfo;
  return typeof value.complete === "boolean" &&
    Array.isArray(value.items) &&
    typeof pageInfo === "object" &&
    pageInfo !== null &&
    "chainId" in pageInfo &&
    "provider" in pageInfo &&
    typeof pageInfo.chainId === "number" &&
    typeof pageInfo.provider === "string";
}

function rotateCandidates(candidates: readonly ProviderCandidate[], offset: number): readonly ProviderCandidate[] {
  if (candidates.length < 2) {
    return candidates;
  }
  const normalizedOffset = ((Math.trunc(offset) % candidates.length) + candidates.length) % candidates.length;
  return normalizedOffset === 0
    ? candidates
    : Object.freeze([...candidates.slice(normalizedOffset), ...candidates.slice(0, normalizedOffset)]);
}

function invalidProviderResponse(candidate: ProviderCandidate): EvmDataError {
  return new EvmDataError({
    code: "INVALID_PROVIDER_RESPONSE",
    message: "Provider returned an invalid normalized result.",
    retryable: false,
    provider: candidate.adapter.name,
    chainId: candidate.chain.chainId,
  });
}

function callerAborted(candidate?: ProviderCandidate): EvmDataError {
  return new EvmDataError({
    code: "REQUEST_ABORTED",
    message: "Request was aborted by the caller.",
    retryable: false,
    ...(candidate === undefined ? {} : { provider: candidate.adapter.name, chainId: candidate.chain.chainId }),
  });
}
