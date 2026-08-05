import { describe, expect, it } from "vitest";

import { EvmDataClient } from "../../src/client/EvmDataClient";
import { parseClientConfiguration } from "../../src/domain/configuration";
import { EvmDataError } from "../../src/domain/errors";
import type { TokenPriceProviderName, TokenPriceProviderResult } from "../../src/domain/priceModels";
import { normalizeTokenPriceHistoryRequest } from "../../src/domain/priceOperations";
import { BinanceAdapter } from "../../src/providers/price/binance/BinanceAdapter";
import { CoinbaseAdapter } from "../../src/providers/price/coinbase/CoinbaseAdapter";
import { GeckoTerminalAdapter } from "../../src/providers/price/geckoterminal/GeckoTerminalAdapter";
import { OkxAdapter } from "../../src/providers/price/okx/OkxAdapter";
import { PriceProviderRouter } from "../../src/price/PriceProviderRouter";
import { PriceRequestExecutor } from "../../src/price/PriceRequestExecutor";
import { TokenPriceAggregator } from "../../src/price/TokenPriceAggregator";
import type { PriceProviderAttemptContext, TokenPriceProviderAdapter } from "../../src/price/TokenPriceProviderAdapter";
import { HttpTransportError, type HttpRequest, type HttpResponse, type HttpTransport } from "../../src/transport/HttpTransport";
import {
  binanceEthUsdtDailyKlines,
  binanceEthUsdtExchangeInfo,
  coinbaseEthUsdDailyCandles,
  coinbaseEthUsdProducts,
  geckoEthSearchPools,
  geckoEthUsdDailyOhlcv,
  okxEthUsdtDailyCandles,
  okxEthUsdtSpotInstruments,
  tokenPriceFixtureDay,
} from "../fixtures/token-price";

const day = tokenPriceFixtureDay;
const dayMilliseconds = Date.UTC(2026, 6, 1);
const daySeconds = dayMilliseconds / 1_000;

class SequenceTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  private index = 0;

  constructor(private readonly responses: readonly (HttpResponse | Error)[]) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const response = this.responses[this.index++];
    if (response === undefined) throw new Error("Missing fixture response.");
    if (response instanceof Error) throw response;
    return response;
  }
}

function response(body: unknown, status = 200, headers: Record<string, string> = {}): HttpResponse {
  return { status, headers, body };
}

function request(range: unknown = { kind: "date", date: day }) {
  return normalizeTokenPriceHistoryRequest({ token: "Ethereum", range }, { now: new Date("2026-08-05T12:00:00.000Z") });
}

function context(overrides: Partial<PriceProviderAttemptContext> = {}): PriceProviderAttemptContext {
  return { proxy: null, timeoutMs: 1_000, correlationId: "fixture", nowMs: Date.UTC(2026, 7, 5), ...overrides };
}

function providerResult(provider: TokenPriceProviderName): TokenPriceProviderResult {
  return {
    provider,
    status: "success",
    token: { input: "ETH", normalized: "eth", symbol: "ETH", name: "Ethereum" },
    market: { product: provider === "coinbase" ? "ETH-USD" : "ETHUSDT", quoteAsset: provider === "coinbase" || provider === "geckoterminal" ? "USD" : "USDT", sourceKind: provider === "geckoterminal" ? "onchain" : "exchange", network: provider === "geckoterminal" ? "eth" : null, tokenAddress: provider === "geckoterminal" ? "0x1111111111111111111111111111111111111111" : null, poolAddress: provider === "geckoterminal" ? "0x2222222222222222222222222222222222222222" : null },
    interval: "1d",
    timezone: "UTC",
    requestedRange: { kind: "date", startDate: day, endDate: day },
    points: [{ date: day, timestamp: "2026-07-01T00:00:00.000Z", open: "1", high: "2", low: "0.5", close: "1.5", price: "1.5", volume: "100", isFinal: true }],
    missingDates: [],
  };
}

function fixedAdapter(provider: TokenPriceProviderName, failure?: EvmDataError): TokenPriceProviderAdapter {
  return {
    name: provider,
    supports: () => true,
    getPriceHistory: async () => {
      if (failure !== undefined) throw failure;
      return providerResult(provider);
    },
  };
}

describe("price provider adapters", () => {
  it("maps Binance active Spot USDT daily data without fabricating missing days", async () => {
    const transport = new SequenceTransport([
      response(binanceEthUsdtExchangeInfo),
      response(binanceEthUsdtDailyKlines),
    ]);
    const result = await new BinanceAdapter({ transport }).getPriceHistory(request(), context());
    expect(result.market).toMatchObject({ product: "ETHUSDT", quoteAsset: "USDT", sourceKind: "exchange" });
    expect(result.points[0]).toMatchObject({ date: day, price: "1.5", close: "1.5", volume: "100" });
    expect(transport.requests[1]?.params).toMatchObject({ symbol: "ETHUSDT", interval: "1d" });
    expect(transport.requests.every((entry) => entry.proxy === null)).toBe(true);
  });

  it("deduplicates Binance rows, sorts UTC days, and exposes missing days without filling them", async () => {
    const julyThird = Date.UTC(2026, 6, 3);
    const transport = new SequenceTransport([
      response(binanceEthUsdtExchangeInfo),
      response([
        [julyThird, "3", "4", "2", "3.5", "300"],
        [dayMilliseconds, "1", "2", "0.5", "1.5", "100"],
        [dayMilliseconds, "1.1", "2.1", "0.6", "1.6", "101"],
      ]),
    ]);
    const result = await new BinanceAdapter({ transport }).getPriceHistory(
      request({ kind: "between", startDate: "2026-07-01", endDate: "2026-07-03" }),
      context(),
    );
    expect(result.points.map((point) => point.date)).toEqual(["2026-07-01", "2026-07-03"]);
    expect(result.points[0]).toMatchObject({ close: "1.6", price: "1.6" });
    expect(result.missingDates).toEqual(["2026-07-02"]);
  });

  it("rejects inactive Binance and invalid Binance payloads with typed provider errors", async () => {
    const inactive = new BinanceAdapter({ transport: new SequenceTransport([response({ symbols: [{ symbol: "ETHUSDT", status: "BREAK", isSpotTradingAllowed: true }] })]) });
    await expect(inactive.getPriceHistory(request(), context())).rejects.toMatchObject({ code: "MARKET_NOT_FOUND" });
    const malformed = new BinanceAdapter({ transport: new SequenceTransport([
      response({ symbols: [{ symbol: "ETHUSDT", status: "TRADING" }] }),
      response([[dayMilliseconds, "not-a-decimal"]]),
    ]) });
    await expect(malformed.getPriceHistory(request(), context())).rejects.toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });

  it("maps newest-first OKX candles, preserves completion, and excludes non-Spot markets", async () => {
    const transport = new SequenceTransport([
      response(okxEthUsdtSpotInstruments),
      response(okxEthUsdtDailyCandles),
    ]);
    const result = await new OkxAdapter({ transport }).getPriceHistory(request(), context());
    expect(result.market).toMatchObject({ product: "ETH-USDT", quoteAsset: "USDT" });
    expect(result.points).toMatchObject([{ date: day, price: "1.5", isFinal: true }]);
    expect(transport.requests[1]?.url).toContain("/api/v5/market/history-candles");
    expect(transport.requests[1]?.params).toMatchObject({ bar: "1Dutc" });
  });

  it("chunks OKX history internally and deduplicates rows across chunk boundaries", async () => {
    const startMilliseconds = Date.UTC(2026, 0, 1);
    const endMilliseconds = Date.UTC(2026, 3, 11);
    const transport = new SequenceTransport([
      response(okxEthUsdtSpotInstruments),
      response({ code: "0", data: [[String(startMilliseconds), "1", "2", "0.5", "1.5", "100", "0", "0", "1"]] }),
      response({ code: "0", data: [
        [String(endMilliseconds), "2", "3", "1", "2.5", "200", "0", "0", "1"],
        [String(startMilliseconds), "1.1", "2.1", "0.6", "1.6", "101", "0", "0", "1"],
      ] }),
    ]);
    const result = await new OkxAdapter({ transport }).getPriceHistory(
      request({ kind: "between", startDate: "2026-01-01", endDate: "2026-04-11" }),
      context(),
    );
    expect(transport.requests.filter((entry) => entry.url.endsWith("/history-candles"))).toHaveLength(2);
    expect(result.points.map((point) => point.date)).toEqual(["2026-01-01", "2026-04-11"]);
    expect(result.points[0]).toMatchObject({ close: "1.6" });
  });

  it("maps Coinbase UTC candles and chunks an internal inclusive range", async () => {
    const transport = new SequenceTransport([
      response(coinbaseEthUsdProducts),
      response([[Date.UTC(2025, 6, 1) / 1_000, "0.5", "2", "1", "1.5", "100"], [Date.UTC(2026, 3, 27) / 1_000, "0.6", "2.1", "1.1", "1.6", "101"]]),
      response([[Date.UTC(2026, 3, 27) / 1_000, "0.7", "2.2", "1.2", "1.7", "102"], [Date.UTC(2026, 4, 31) / 1_000, "0.8", "2.3", "1.3", "1.8", "103"]]),
    ]);
    const result = await new CoinbaseAdapter({ transport }).getPriceHistory(request({ kind: "between", startDate: "2025-07-01", endDate: "2026-05-31" }), context());
    expect(result.market).toMatchObject({ product: "ETH-USD", quoteAsset: "USD" });
    expect(transport.requests.filter((entry) => entry.url.endsWith("/candles"))).toHaveLength(2);
    expect(result.points).toHaveLength(3);
    expect(result.points.map((point) => point.date)).toEqual(["2025-07-01", "2026-04-27", "2026-05-31"]);
    expect(result.points[1]).toMatchObject({ close: "1.7", price: "1.7" });
    expect(result.missingDates).toHaveLength(332);
  });

  it("resolves GeckoTerminal on-chain metadata and refuses ambiguous symbol matches", async () => {
    const search = structuredClone(geckoEthSearchPools);
    const transport = new SequenceTransport([response(search), response(geckoEthUsdDailyOhlcv)]);
    const result = await new GeckoTerminalAdapter({ transport, networks: ["eth"] }).getPriceHistory(request(), context());
    expect(result.market).toMatchObject({ sourceKind: "onchain", network: "eth", tokenAddress: "0x1111111111111111111111111111111111111111", poolAddress: "0x2222222222222222222222222222222222222222", quoteAsset: "USD" });
    expect(transport.requests[1]?.params).toMatchObject({ aggregate: 1, currency: "usd", token: "base" });

    const ambiguous = structuredClone(search) as typeof search;
    ambiguous.data.push({
      id: "eth_0x3333333333333333333333333333333333333333",
      type: "pool",
      attributes: { address: "0x3333333333333333333333333333333333333333", reserve_in_usd: "1000", volume_usd: { h24: "10" } },
      relationships: {
        network: { data: { id: "eth", type: "network" } },
        base_token: { data: { id: "eth_0x4444444444444444444444444444444444444444", type: "token" } },
        quote_token: { data: null },
      },
    });
    ambiguous.included.push({ id: "eth_0x4444444444444444444444444444444444444444", type: "token", attributes: { address: "0x4444444444444444444444444444444444444444", symbol: "ETH", name: "Ethereum" } });
    await expect(new GeckoTerminalAdapter({ transport: new SequenceTransport([response(ambiguous)]), networks: ["eth"] }).getPriceHistory(request(), context())).rejects.toMatchObject({ code: "TOKEN_AMBIGUOUS" });
  });

  it("requests quote-side USD OHLCV when the resolved token is the pool quote token", async () => {
    const search = structuredClone(geckoEthSearchPools);
    const pool = search.data[0] as unknown as {
      relationships: {
        base_token: { data: { id: string; type: string } | null };
        quote_token: { data: { id: string; type: string } | null };
      };
    } | undefined;
    if (pool === undefined) throw new Error("Fixture pool is missing.");
    pool.relationships.base_token.data = { id: "eth_0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", type: "token" };
    pool.relationships.quote_token = { data: { id: "eth_0x1111111111111111111111111111111111111111", type: "token" } };
    search.included.push({ id: "eth_0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", type: "token", attributes: { address: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", symbol: "USDC", name: "USD Coin" } });
    const transport = new SequenceTransport([response(search), response(geckoEthUsdDailyOhlcv)]);
    const result = await new GeckoTerminalAdapter({ transport, networks: ["eth"] }).getPriceHistory(request(), context());
    expect(result.market.tokenAddress).toBe("0x1111111111111111111111111111111111111111");
    expect(transport.requests[1]?.params).toMatchObject({ currency: "usd", token: "quote" });
  });

  it("classifies 429, selected 5xx, timeout, and current-day finality without exposing payloads", async () => {
    const adapter = new BinanceAdapter({ transport: new SequenceTransport([response({ error: "raw provider payload" }, 429, { "retry-after": "1" })]) });
    await expect(adapter.getPriceHistory(request(), context())).rejects.toMatchObject({ code: "RATE_LIMITED", retryable: true, retryAfterMs: 1_000 });

    const unavailable = new CoinbaseAdapter({ transport: new SequenceTransport([response({ error: "raw provider payload" }, 503)]) });
    await expect(unavailable.getPriceHistory(request(), context())).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE", retryable: true });

    const timeout = new OkxAdapter({ transport: new SequenceTransport([new HttpTransportError({ code: "REQUEST_TIMEOUT", message: "timeout with raw body", retryable: true })]) });
    await expect(timeout.getPriceHistory(request(), context())).rejects.toMatchObject({ code: "REQUEST_TIMEOUT", retryable: true });

    const currentDay = "2026-08-05";
    const finality = new BinanceAdapter({ transport: new SequenceTransport([
      response(binanceEthUsdtExchangeInfo),
      response([[Date.UTC(2026, 7, 5), "1", "2", "0.5", "1.5", "100"]]),
    ]) });
    const result = await finality.getPriceHistory(request({ kind: "date", date: currentDay }), context({ nowMs: Date.UTC(2026, 7, 5, 23, 59, 59) }));
    expect(result.points[0]?.isFinal).toBe(false);
  });
});

describe("token price aggregation", () => {
  const providers = ["binance", "okx", "coinbase", "geckoterminal"] as const;

  it("returns four ordered successes through the public token service with direct routes", async () => {
    const received: Array<PriceProviderAttemptContext["proxy"]> = [];
    const adapters: Partial<Record<TokenPriceProviderName, TokenPriceProviderAdapter>> = Object.fromEntries(providers.map((provider) => [provider, {
      ...fixedAdapter(provider),
      getPriceHistory: async (_request: unknown, attempt: PriceProviderAttemptContext) => {
        received.push(attempt.proxy);
        return providerResult(provider);
      },
    }]));
    const client = new EvmDataClient({ price: { routeMode: "direct" } }, { priceAdapters: adapters });
    const result = await client.token.getPriceHistory({ token: "ETH", range: { kind: "date", date: day } });
    expect(result.results.map((entry) => entry.provider)).toEqual(providers);
    expect(result.summary).toEqual({ requestedProviders: 4, succeededProviders: 4, failedProviders: 0, partial: false });
    expect(received).toEqual([null, null, null, null]);
  });

  it("keeps partial failures, retries eligible throttling only, and throws aggregate unavailability", async () => {
    const limited = new EvmDataError({ code: "RATE_LIMITED", message: "limited", retryable: false, provider: "coinbase" });
    const client = new EvmDataClient({ price: { providers: providers.map((kind) => ({ kind })) } }, {
      priceAdapters: {
        binance: fixedAdapter("binance"), okx: fixedAdapter("okx"), coinbase: fixedAdapter("coinbase", limited), geckoterminal: fixedAdapter("geckoterminal"),
      },
    });
    const partial = await client.token.getPriceHistory({ token: "ETH", range: { kind: "date", date: day } });
    expect(partial.summary).toEqual({ requestedProviders: 4, succeededProviders: 3, failedProviders: 1, partial: true });
    expect(partial.failures).toMatchObject([{ provider: "coinbase", code: "RATE_LIMITED" }]);

    const unavailableAdapters: Partial<Record<TokenPriceProviderName, TokenPriceProviderAdapter>> = Object.fromEntries(providers.map((provider) => [provider, fixedAdapter(provider, new EvmDataError({ code: "MARKET_NOT_FOUND", message: "market missing", retryable: false, provider }))]));
    const allUnavailable = new EvmDataClient({ price: { providers: providers.map((kind) => ({ kind })) } }, { priceAdapters: unavailableAdapters });
    await expect(allUnavailable.token.getPriceHistory({ token: "ETH", range: { kind: "date", date: day } })).rejects.toMatchObject({ code: "PRICE_DATA_UNAVAILABLE" });
  });

  it("honors proxy-only and caller abort without a direct fallback", async () => {
    const adapter = fixedAdapter("binance");
    const unavailable = new EvmDataClient({ price: { providers: [{ kind: "binance" }], routeMode: "proxy-only" } }, { priceAdapters: { binance: adapter } });
    await expect(unavailable.token.getPriceHistory({ token: "ETH", range: { kind: "date", date: day } })).rejects.toMatchObject({ code: "PROXY_ERROR" });

    let observedProxy: PriceProviderAttemptContext["proxy"] = null;
    const proxied = new EvmDataClient({ price: { providers: [{ kind: "binance" }], routeMode: "proxy-only" }, proxies: [{ url: "http://proxy.test:8080" }] }, { priceAdapters: { binance: { ...adapter, getPriceHistory: async (_request, attempt) => { observedProxy = attempt.proxy; return providerResult("binance"); } } } });
    await proxied.token.getPriceHistory({ token: "ETH", range: { kind: "date", date: day } });
    expect(observedProxy).toMatchObject({ id: "proxy-1", url: "http://proxy.test:8080" });

    const controller = new AbortController();
    controller.abort();
    await expect(proxied.token.getPriceHistory({ token: "ETH", range: { kind: "date", date: day }, signal: controller.signal })).rejects.toMatchObject({ code: "REQUEST_ABORTED" });
  });

  it("retries eligible failures, aborts during backoff, and redacts custom failure messages", async () => {
    const normalized = parseClientConfiguration({ price: { providers: [{ kind: "binance" }], attemptTimeoutMs: 1_000, totalTimeoutMs: 10_000 } });
    const configuration = normalized.price;
    if (configuration === undefined) throw new Error("Price configuration is missing.");
    let now = Date.UTC(2026, 7, 5);
    const waits: number[] = [];
    let attempts = 0;
    const retrying: TokenPriceProviderAdapter = {
      name: "binance", supports: () => true, getPriceHistory: async () => {
        attempts += 1;
        if (attempts === 1) throw new EvmDataError({ code: "RATE_LIMITED", message: "upstream 429", retryable: true, provider: "binance" });
        return providerResult("binance");
      },
    };
    const executor = new PriceRequestExecutor({
      configuration,
      proxies: [],
      clock: { now: () => now },
      wait: async (milliseconds) => { waits.push(milliseconds); now += milliseconds; },
      correlationIdFactory: () => "fixture",
    });
    const retryResult = await new TokenPriceAggregator(new PriceProviderRouter([retrying]), executor).getPriceHistory(request());
    expect(retryResult.results).toHaveLength(1);
    expect(attempts).toBe(2);
    expect(waits).toEqual([100]);

    const controller = new AbortController();
    const aborting: TokenPriceProviderAdapter = {
      name: "binance", supports: () => true, getPriceHistory: async () => {
        throw new EvmDataError({ code: "REQUEST_TIMEOUT", message: "upstream timeout", retryable: true, provider: "binance" });
      },
    };
    const abortExecutor = new PriceRequestExecutor({
      configuration, proxies: [], clock: { now: () => now }, correlationIdFactory: () => "fixture",
      wait: async () => { controller.abort(); throw new EvmDataError({ code: "REQUEST_ABORTED", message: "aborted", retryable: false }); },
    });
    await expect(new TokenPriceAggregator(new PriceProviderRouter([aborting]), abortExecutor).getPriceHistory({ ...request(), signal: controller.signal })).rejects.toMatchObject({ code: "REQUEST_ABORTED" });

    const leaking = new EvmDataError({ code: "NETWORK_ERROR", message: "https://user:proxy-password@provider.example/path?token=secret-response", retryable: false, provider: "coinbase" });
    const safeResult = await new EvmDataClient({ price: { providers: [{ kind: "binance" }, { kind: "coinbase" }] } }, {
      priceAdapters: { binance: fixedAdapter("binance"), coinbase: fixedAdapter("coinbase", leaking) },
    }).token.getPriceHistory({ token: "ETH", range: { kind: "date", date: day } });
    expect(safeResult.failures).toMatchObject([{ provider: "coinbase", code: "NETWORK_ERROR" }]);
    expect(JSON.stringify(safeResult.failures)).not.toContain("proxy-password");
    expect(JSON.stringify(safeResult.failures)).not.toContain("provider.example");
    expect(JSON.stringify(safeResult.failures)).not.toContain("secret-response");
  });
});

describe("price domain contracts", () => {
  it("normalizes latest/date/between UTC selectors and rejects date boundaries", () => {
    expect(normalizeTokenPriceHistoryRequest({ token: "Ethereum", range: { kind: "latest", days: 30 } }, { now: new Date("2026-08-05T23:00:00.000Z") }).resolvedRange).toEqual({ kind: "latest", startDate: "2026-07-07", endDate: "2026-08-05" });
    expect(normalizeTokenPriceHistoryRequest({ token: "btc", range: { kind: "date", date: day } }, { now: new Date("2026-08-05T00:00:00.000Z") })).toMatchObject({ baseSymbol: "BTC", resolvedRange: { startDate: day, endDate: day } });
    for (const invalid of [
      { token: "ETH", range: { kind: "date", date: "2026-02-30" } },
      { token: "ETH", range: { kind: "date", date: "2026-08-06" } },
      { token: "ETH", range: { kind: "between", startDate: "2026-07-02", endDate: "2026-07-01" } },
      { token: "ETH", range: { kind: "between", startDate: "2025-01-01", endDate: "2026-01-02" } },
    ]) {
      expect(() => normalizeTokenPriceHistoryRequest(invalid, { now: new Date("2026-08-05T00:00:00.000Z") })).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
    }
  });
});
