import { describe, expect, it } from "vitest";

import { ChainRegistry } from "../../src/chains/ChainRegistry";
import { EvmDataError } from "../../src/domain/errors";
import type { NormalizedRequestPolicy } from "../../src/domain/configuration";
import type { NativeBalance } from "../../src/domain/models";
import { normalizeNativeBalanceRequest, normalizeTransactionsRequest } from "../../src/domain/operations";
import { ProviderRouter } from "../../src/execution/ProviderRouter";
import { RequestExecutor } from "../../src/execution/RequestExecutor";
import { CredentialPool } from "../../src/execution/CredentialPool";
import { ProxyPool } from "../../src/execution/ProxyPool";
import { queryFingerprint, encodeCursor } from "../../src/execution/cursorCodec";
import type { Clock, RandomSource, WaitFunction } from "../../src/execution/clock";
import type { DataProviderAdapter, ProviderAttemptContext } from "../../src/providers/DataProviderAdapter";

const address = "0x1234567890abcdef1234567890abcdef12345678";

class FakeClock implements Clock {
  current = 0;

  now(): number {
    return this.current;
  }

  advance(value: number): void {
    this.current += value;
  }
}

const deterministicRandom: RandomSource = { next: () => 0 };

function policy(overrides: Partial<NormalizedRequestPolicy> = {}): NormalizedRequestPolicy {
  return {
    attemptTimeoutMs: 100,
    totalTimeoutMs: 1_000,
    maxTotalAttempts: 4,
    allowDirect: true,
    providerPacingMs: {},
    ...overrides,
  };
}

function balance(provider: string): NativeBalance {
  return {
    chainId: 1,
    address,
    amount: "123",
    decimals: 18,
    symbol: "ETH",
    blockNumber: "100",
    provider,
  };
}

function nativeAdapter(
  name: string,
  handler: (request: Parameters<NonNullable<DataProviderAdapter["getNativeBalance"]>>[0], context: ProviderAttemptContext) => Promise<NativeBalance>,
): DataProviderAdapter {
  return {
    name,
    supports: (capability) => capability.operation === "getNativeBalance" && capability.chain.chainId === 1,
    getNativeBalance: handler,
  };
}

function executor(
  router: ProviderRouter,
  options: {
    requestPolicy?: NormalizedRequestPolicy;
    clock?: FakeClock;
    random?: RandomSource;
    credentialPools?: ReadonlyMap<string, CredentialPool>;
    proxyPool?: ProxyPool;
    wait?: WaitFunction;
    observe?: (event: Parameters<NonNullable<import("../../src/domain/configuration").ObservationCallback>>[0]) => void;
  } = {},
): RequestExecutor {
  return new RequestExecutor({
    router,
    requestPolicy: options.requestPolicy ?? policy(),
    random: options.random ?? deterministicRandom,
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    ...(options.credentialPools === undefined ? {} : { credentialPools: options.credentialPools }),
    ...(options.proxyPool === undefined ? {} : { proxyPool: options.proxyPool }),
    ...(options.wait === undefined ? {} : { wait: options.wait }),
    ...(options.observe === undefined ? {} : { observe: options.observe }),
  });
}

describe("RequestExecutor", () => {
  it("rotates an invalid credential and succeeds within one total attempt budget", async () => {
    const seen: string[] = [];
    const adapter = nativeAdapter("etherscan", async (_request, context) => {
      seen.push(context.credential?.id ?? "none");
      if (context.credential?.id === "etherscan-main-key-1") {
        throw new EvmDataError({
          code: "AUTHENTICATION_FAILED",
          message: "invalid key",
          retryable: false,
        });
      }
      return balance("etherscan");
    });
    const router = new ProviderRouter(new ChainRegistry(), [{
      configurationId: "etherscan-main",
      adapter,
    }]);
    const pool = new CredentialPool(["key-a", "key-b"], { providerConfigurationId: "etherscan-main" });
    const result = await executor(router, {
      credentialPools: new Map([["etherscan-main", pool]]),
    }).execute(normalizeNativeBalanceRequest({ chain: 1, address }));

    expect(result).toEqual(balance("etherscan"));
    expect(seen).toEqual(["etherscan-main-key-1", "etherscan-main-key-2"]);
  });

  it("rotates a rate-limited credential before retrying the same provider", async () => {
    const seen: string[] = [];
    const adapter = nativeAdapter("etherscan", async (_request, context) => {
      seen.push(context.credential?.id ?? "none");
      if (context.credential?.id === "etherscan-main-key-1") {
        throw new EvmDataError({
          code: "RATE_LIMITED",
          message: "rate limited",
          retryable: true,
          retryAfterMs: 500,
        });
      }
      return balance("etherscan");
    });
    const router = new ProviderRouter(new ChainRegistry(), [{ configurationId: "etherscan-main", adapter }]);
    const pool = new CredentialPool(["key-a", "key-b"], { providerConfigurationId: "etherscan-main" });

    await expect(executor(router, {
      credentialPools: new Map([["etherscan-main", pool]]),
    }).execute(normalizeNativeBalanceRequest({ chain: 1, address }))).resolves.toEqual(balance("etherscan"));
    expect(seen).toEqual(["etherscan-main-key-1", "etherscan-main-key-2"]);
  });

  it("falls back on an invalid first-page provider payload", async () => {
    let fallbackCalls = 0;
    const invalid = nativeAdapter("first", async () => null as never);
    const fallback = nativeAdapter("second", async () => {
      fallbackCalls += 1;
      return balance("second");
    });
    const router = new ProviderRouter(new ChainRegistry(), [
      { configurationId: "first-config", adapter: invalid },
      { configurationId: "second-config", adapter: fallback },
    ]);

    const result = await executor(router).execute(normalizeNativeBalanceRequest({ chain: 1, address }));
    expect(result).toEqual(balance("second"));
    expect(fallbackCalls).toBe(1);
  });

  it("keeps continuation on its pinned provider and never calls a fallback", async () => {
    const requestWithoutCursor = normalizeTransactionsRequest({ chain: 1, address });
    const cursor = encodeCursor({
      version: 1,
      operation: "getTransactions",
      provider: "first",
      providerConfigurationId: "first-config",
      chainId: 1,
      queryFingerprint: queryFingerprint(requestWithoutCursor, 1),
      providerPageState: { page: 2 },
    });
    const request = normalizeTransactionsRequest({ chain: 1, address, cursor });
    let fallbackCalls = 0;
    const first: DataProviderAdapter = {
      name: "first",
      supports: () => true,
      getTransactions: async () => {
        throw new EvmDataError({ code: "NETWORK_ERROR", message: "down", retryable: true });
      },
    };
    const fallback: DataProviderAdapter = {
      name: "second",
      supports: () => true,
      getTransactions: async () => {
        fallbackCalls += 1;
        throw new Error("continuation fallback must not run");
      },
    };
    const router = new ProviderRouter(new ChainRegistry(), [
      { configurationId: "first-config", adapter: first },
      { configurationId: "second-config", adapter: fallback },
    ]);

    await expect(executor(router, { requestPolicy: policy({ maxTotalAttempts: 1 }) }).execute(request))
      .rejects.toMatchObject({ code: "NETWORK_ERROR" });
    expect(fallbackCalls).toBe(0);
  });

  it("stops a backoff immediately when the caller aborts", async () => {
    const controller = new AbortController();
    const clock = new FakeClock();
    const adapter = nativeAdapter("etherscan", async () => {
      throw new EvmDataError({ code: "NETWORK_ERROR", message: "down", retryable: true });
    });
    const wait: WaitFunction = async () => {
      controller.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    };
    const router = new ProviderRouter(new ChainRegistry(), [{ configurationId: "etherscan-main", adapter }]);

    await expect(executor(router, { clock, wait, random: { next: () => 1 } }).execute(
      normalizeNativeBalanceRequest({ chain: 1, address, signal: controller.signal }),
    )).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
  });

  it("enforces the overall deadline across retry waits", async () => {
    const clock = new FakeClock();
    let calls = 0;
    const adapter = nativeAdapter("etherscan", async () => {
      calls += 1;
      throw new EvmDataError({ code: "NETWORK_ERROR", message: "down", retryable: true });
    });
    const wait: WaitFunction = async (delay) => {
      clock.advance(delay);
    };
    const router = new ProviderRouter(new ChainRegistry(), [{ configurationId: "etherscan-main", adapter }]);

    await expect(executor(router, {
      clock,
      wait,
      random: { next: () => 1 },
      requestPolicy: policy({ totalTimeoutMs: 50 }),
    }).execute(normalizeNativeBalanceRequest({ chain: 1, address }))).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
    });
    expect(calls).toBe(1);
  });

  it("does not silently use a direct route when proxy policy forbids it", async () => {
    let calls = 0;
    const adapter = nativeAdapter("etherscan", async () => {
      calls += 1;
      return balance("etherscan");
    });
    const router = new ProviderRouter(new ChainRegistry(), [{ configurationId: "etherscan-main", adapter }]);

    await expect(executor(router, {
      proxyPool: new ProxyPool([], { allowDirect: false }),
      requestPolicy: policy({ maxTotalAttempts: 2 }),
    }).execute(normalizeNativeBalanceRequest({ chain: 1, address }))).rejects.toMatchObject({
      code: "PROXY_ERROR",
    });
    expect(calls).toBe(0);
  });

  it("uses the normalized request policy when no proxy pool is supplied", async () => {
    let calls = 0;
    const adapter = nativeAdapter("etherscan", async () => {
      calls += 1;
      return balance("etherscan");
    });
    const router = new ProviderRouter(new ChainRegistry(), [{ configurationId: "etherscan-main", adapter }]);

    await expect(executor(router, {
      requestPolicy: policy({ allowDirect: false }),
    }).execute(normalizeNativeBalanceRequest({ chain: 1, address }))).rejects.toMatchObject({
      code: "PROXY_ERROR",
    });
    expect(calls).toBe(0);
  });

  it("emits only sanitized structured attempt events", async () => {
    const events: Array<Record<string, unknown>> = [];
    const adapter = nativeAdapter("etherscan", async () => balance("etherscan"));
    const router = new ProviderRouter(new ChainRegistry(), [{ configurationId: "etherscan-main", adapter }]);
    await executor(router, { observe: (event) => events.push(event as unknown as Record<string, unknown>) })
      .execute(normalizeNativeBalanceRequest({ chain: 1, address }));
    expect(events).toEqual([
      expect.objectContaining({
        operation: "getNativeBalance",
        chainId: 1,
        provider: "etherscan",
        attempt: 1,
        outcome: "success",
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("key");
  });

  it("paces sequential attempts for the configured provider", async () => {
    const clock = new FakeClock();
    const waits: number[] = [];
    const adapter = nativeAdapter("etherscan", async () => balance("etherscan"));
    const router = new ProviderRouter(new ChainRegistry(), [{ configurationId: "etherscan-main", adapter }]);
    const wait: WaitFunction = async (delay) => {
      waits.push(delay);
      clock.advance(delay);
    };
    const runner = executor(router, {
      clock,
      wait,
      requestPolicy: policy({ providerPacingMs: { etherscan: 100 } }),
    });

    await runner.execute(normalizeNativeBalanceRequest({ chain: 1, address }));
    await runner.execute(normalizeNativeBalanceRequest({ chain: 1, address }));
    expect(waits).toEqual([100]);
  });

  it("rotates to another proxy after a proxy-boundary failure", async () => {
    const seenRoutes: string[] = [];
    const adapter = nativeAdapter("etherscan", async (_request, context) => {
      seenRoutes.push(context.proxy?.id ?? "direct");
      if (seenRoutes.length === 1) {
        throw new EvmDataError({
          code: "PROXY_ERROR",
          message: "proxy unavailable",
          retryable: true,
        });
      }
      return balance("etherscan");
    });
    const router = new ProviderRouter(new ChainRegistry(), [{ configurationId: "etherscan-main", adapter }]);
    const runner = executor(router, {
      proxyPool: new ProxyPool(["http://proxy-a:8080", "http://proxy-b:8080"], { allowDirect: false }),
      requestPolicy: policy({ allowDirect: false, maxTotalAttempts: 2 }),
    });

    await expect(runner.execute(normalizeNativeBalanceRequest({ chain: 1, address }))).resolves.toEqual(balance("etherscan"));
    expect(seenRoutes).toEqual(["proxy-1", "proxy-2"]);
  });

  it("round-robins sequential requests across proxies and the direct route", async () => {
    const seenRoutes: string[] = [];
    const adapter = nativeAdapter("etherscan", async (_request, context) => {
      seenRoutes.push(context.proxy?.id ?? "direct");
      return balance("etherscan");
    });
    const router = new ProviderRouter(new ChainRegistry(), [{ configurationId: "etherscan-main", adapter }]);
    const runner = executor(router, {
      proxyPool: new ProxyPool(["http://proxy-a:8080", "http://proxy-b:8080"], { allowDirect: true }),
    });

    await runner.execute(normalizeNativeBalanceRequest({ chain: 1, address }));
    await runner.execute(normalizeNativeBalanceRequest({ chain: 1, address }));
    await runner.execute(normalizeNativeBalanceRequest({ chain: 1, address }));
    expect(seenRoutes).toEqual(["proxy-1", "proxy-2", "direct"]);
  });

  it("passively cools a failing provider for the next first-page request", async () => {
    const clock = new FakeClock();
    let firstCalls = 0;
    let fallbackCalls = 0;
    const first = nativeAdapter("first", async () => {
      firstCalls += 1;
      throw new EvmDataError({ code: "PROVIDER_UNAVAILABLE", message: "down", retryable: true });
    });
    const fallback = nativeAdapter("second", async () => {
      fallbackCalls += 1;
      return balance("second");
    });
    const router = new ProviderRouter(new ChainRegistry(), [
      { configurationId: "first-config", adapter: first },
      { configurationId: "second-config", adapter: fallback },
    ]);
    const runner = executor(router, {
      clock,
      requestPolicy: policy({ maxTotalAttempts: 3 }),
      wait: async (delay) => clock.advance(delay),
      random: { next: () => 0 },
    });

    await expect(runner.execute(normalizeNativeBalanceRequest({ chain: 1, address }))).resolves.toEqual(balance("second"));
    expect(firstCalls).toBe(2);
    clock.advance(1);
    await expect(runner.execute(normalizeNativeBalanceRequest({ chain: 1, address }))).resolves.toEqual(balance("second"));
    expect(firstCalls).toBe(2);
    expect(fallbackCalls).toBe(2);
  });

  it("redacts credential echoes from custom adapter error messages", async () => {
    const proxyUrl = "http://proxy-user:proxy-password-secret@proxy.example:8080/";
    const adapter = nativeAdapter("etherscan", async () => {
      throw new EvmDataError({
        code: "PROVIDER_UNAVAILABLE",
        message: `Bearer key-secret via ${proxyUrl}`,
        retryable: false,
      });
    });
    const router = new ProviderRouter(new ChainRegistry(), [{ configurationId: "etherscan-main", adapter }]);
    const pool = new CredentialPool(["key-secret"], { providerConfigurationId: "etherscan-main" });
    const result = await executor(router, {
      credentialPools: new Map([["etherscan-main", pool]]),
      proxyPool: new ProxyPool([proxyUrl], { allowDirect: false }),
      requestPolicy: policy({ allowDirect: false, maxTotalAttempts: 1 }),
    }).execute(normalizeNativeBalanceRequest({ chain: 1, address })).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(EvmDataError);
    if (!(result instanceof EvmDataError)) {
      throw new Error("Expected the executor to reject with EvmDataError.");
    }
    expect(result).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(result.message).not.toContain("key-secret");
    expect(result.message).not.toContain("proxy-password-secret");
    expect(JSON.stringify(result)).not.toContain("key-secret");
    expect(JSON.stringify(result)).not.toContain("proxy-password-secret");
  });

  it("redacts provider page state from custom continuation errors", async () => {
    const request = normalizeTransactionsRequest({
      chain: 1,
      address,
      pageSize: 1,
      cursor: encodeCursor({
        version: 1,
        operation: "getTransactions",
        provider: "custom-provider",
        providerConfigurationId: "custom-config",
        chainId: 1,
        queryFingerprint: queryFingerprint(normalizeTransactionsRequest({ chain: 1, address, pageSize: 1 }), 1),
        providerPageState: { pageKey: "provider-page-secret" },
      }),
    });
    const adapter: DataProviderAdapter = {
      name: "custom-provider",
      supports: ({ operation }) => operation === "getTransactions",
      getTransactions: async (_value, context) => {
        throw new EvmDataError({
          code: "PROVIDER_UNAVAILABLE",
          message: `provider state echoed ${JSON.stringify(context.providerPageState)}`,
          retryable: false,
        });
      },
    };
    const router = new ProviderRouter(new ChainRegistry(), [{ configurationId: "custom-config", adapter }]);
    const result = await executor(router, { requestPolicy: policy({ maxTotalAttempts: 1 }) })
      .execute(request)
      .catch((error: unknown) => error);

    expect(result).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    expect(JSON.stringify(result)).not.toContain("provider-page-secret");
  });
});
