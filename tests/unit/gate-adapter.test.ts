import { describe, expect, it } from "vitest";

import { normalizeTokenPriceHistoryRequest } from "../../src/domain/priceOperations";
import { GateAdapter } from "../../src/providers/price/gate/GateAdapter";
import type { PriceProviderAttemptContext } from "../../src/price/TokenPriceProviderAdapter";
import { HttpTransportError, type HttpRequest, type HttpResponse, type HttpTransport } from "../../src/transport/HttpTransport";
import {
  gateEthUsdtCurrencyPair,
  gateEthUsdtDailyCandles,
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
  return normalizeTokenPriceHistoryRequest(
    { token: "Ethereum", range },
    { now: new Date("2026-08-05T12:00:00.000Z") },
  );
}

function context(overrides: Partial<PriceProviderAttemptContext> = {}): PriceProviderAttemptContext {
  return {
    proxy: null,
    timeoutMs: 1_000,
    correlationId: "fixture",
    nowMs: Date.UTC(2026, 7, 5),
    ...overrides,
  };
}

describe("GateAdapter", () => {
  it("maps Gate active Spot USDT daily data without fabricating missing days", async () => {
    const transport = new SequenceTransport([
      response(gateEthUsdtCurrencyPair),
      response(gateEthUsdtDailyCandles),
    ]);
    const adapter = new GateAdapter({ transport });
    const result = await adapter.getPriceHistory(request(), context());

    expect(result.provider).toBe("gate");
    expect(result.market).toMatchObject({
      product: "ETH_USDT",
      quoteAsset: "USDT",
      sourceKind: "exchange",
    });
    expect(result.points[0]).toMatchObject({
      date: day,
      price: "1.5",
      close: "1.5",
      open: "1",
      high: "2",
      low: "0.5",
      volume: "100",
      isFinal: true,
    });
    expect(transport.requests[0]?.url).toContain("/api/v4/spot/currency_pairs/ETH_USDT");
    expect(transport.requests[1]?.url).toContain("/api/v4/spot/candlesticks");
    expect(transport.requests[1]?.params).toMatchObject({
      currency_pair: "ETH_USDT",
      interval: "1d",
      from: daySeconds,
      to: daySeconds + 86400 - 1,
    });
  });

  it("deduplicates Gate rows, sorts UTC days, and exposes missing days without filling them", async () => {
    const julyThird = Date.UTC(2026, 6, 3) / 1_000;
    const transport = new SequenceTransport([
      response(gateEthUsdtCurrencyPair),
      response([
        [String(julyThird), "300", "3.5", "4", "2", "3", "75", "true"],
        [String(daySeconds), "100", "1.5", "2", "0.5", "1", "66.6", "true"],
        [String(daySeconds), "101", "1.6", "2.1", "0.6", "1.1", "67", "true"],
      ]),
    ]);
    const adapter = new GateAdapter({ transport });
    const result = await adapter.getPriceHistory(
      request({ kind: "between", startDate: "2026-07-01", endDate: "2026-07-03" }),
      context(),
    );

    expect(result.points.map((p) => p.date)).toEqual(["2026-07-01", "2026-07-03"]);
    expect(result.points[0]).toMatchObject({ close: "1.6", price: "1.6" });
    expect(result.missingDates).toEqual(["2026-07-02"]);
  });

  it("rejects untradable Gate pair with MARKET_NOT_FOUND", async () => {
    const inactive = new GateAdapter({
      transport: new SequenceTransport([
        response({ id: "ETH_USDT", base: "ETH", quote: "USDT", trade_status: "untradable" }),
      ]),
    });
    await expect(inactive.getPriceHistory(request(), context())).rejects.toMatchObject({
      code: "MARKET_NOT_FOUND",
      retryable: false,
    });
  });

  it("rejects malformed Gate candlestick payload with INVALID_PROVIDER_RESPONSE", async () => {
    const malformed = new GateAdapter({
      transport: new SequenceTransport([
        response(gateEthUsdtCurrencyPair),
        response([["not-a-number", "invalid"]]),
      ]),
    });
    await expect(malformed.getPriceHistory(request(), context())).rejects.toMatchObject({
      code: "INVALID_PROVIDER_RESPONSE",
      retryable: false,
    });
  });

  it("classifies 429 with retry-after header as RATE_LIMITED", async () => {
    const adapter = new GateAdapter({
      transport: new SequenceTransport([
        response({ label: "TOO_MANY_REQUESTS", message: "rate limited" }, 429, { "retry-after": "2" }),
      ]),
    });
    await expect(adapter.getPriceHistory(request(), context())).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
      retryAfterMs: 2_000,
    });
  });

  it("classifies 503 as PROVIDER_UNAVAILABLE", async () => {
    const adapter = new GateAdapter({
      transport: new SequenceTransport([
        response({ message: "service unavailable" }, 503),
      ]),
    });
    await expect(adapter.getPriceHistory(request(), context())).rejects.toMatchObject({
      code: "PROVIDER_UNAVAILABLE",
      retryable: true,
    });
  });

  it("normalizes transport timeout errors", async () => {
    const adapter = new GateAdapter({
      transport: new SequenceTransport([
        new HttpTransportError({ code: "REQUEST_TIMEOUT", message: "timeout", retryable: true }),
      ]),
    });
    await expect(adapter.getPriceHistory(request(), context())).rejects.toMatchObject({
      code: "REQUEST_TIMEOUT",
      retryable: true,
    });
  });

  it("chunks long date ranges into multiple requests", async () => {
    // 2026-01-01 to 2026-07-20 is 201 days (> 180 days CANDLE_CHUNK_DAYS) -> 2 chunks
    const transport = new SequenceTransport([
      response(gateEthUsdtCurrencyPair),
      response([[String(Date.UTC(2026, 0, 1) / 1000), "100", "2000", "2100", "1900", "1950", "50", "true"]]),
      response([[String(Date.UTC(2026, 6, 1) / 1000), "100", "3000", "3100", "2900", "2950", "33", "true"]]),
    ]);
    const adapter = new GateAdapter({ transport });
    const result = await adapter.getPriceHistory(
      request({ kind: "between", startDate: "2026-01-01", endDate: "2026-07-20" }),
      context(),
    );
    expect(transport.requests.filter((r) => r.url.endsWith("/candlesticks"))).toHaveLength(2);
    expect(result.points).toHaveLength(2);
  });
});
