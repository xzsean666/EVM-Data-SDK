import { afterEach, describe, expect, it, vi } from "vitest";

import { TokenService } from "../../src/services/TokenService";

describe("TokenService Gate endpoint defaults", () => {
  const originalEndpoints = process.env.GATE_API_BASE_URLS;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (originalEndpoints === undefined) delete process.env.GATE_API_BASE_URLS;
    else process.env.GATE_API_BASE_URLS = originalEndpoints;
  });

  it("uses the built-in Gate endpoint when the environment variable is blank", async () => {
    process.env.GATE_API_BASE_URLS = "";
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(
      JSON.stringify([["1786623480", "1870", "1879.1", "1865", "1875", "100"]]),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const service = new TokenService(
      {} as never,
      {} as never,
      {} as never,
    );
    const points = await service.getGateKlinesPrices({
      pair: "STETH_USDT",
      start: 1786623480000,
      end: 1786623780000,
    });

    expect(points).toHaveLength(1);
    expect(fetchMock.mock.calls[0]?.[0]).toMatchObject({
      href: expect.stringContaining("https://api.gateio.ws/api/v4/spot/candlesticks"),
    });
  });

  it("uses the Gate candle open for persisted hourly history", async () => {
    process.env.GATE_API_BASE_URLS = "";
    const fetchMock = vi.fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>(async () => new Response(
      JSON.stringify([["1780272000", "1870", "434.63", "438.66", "434.63", "438.64", "1875", "1"]]),
      { status: 200, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    const service = new TokenService({} as never, {} as never, {} as never);
    const points = await service.getGateKlinesPrices({
      pair: "TSLA_USDT",
      interval: "1h",
      start: 1780272000000,
      end: 1780275600000,
    });

    expect(points).toEqual([{ timestamp: 1780272000000, priceUsd: "438.64" }]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("interval=1h");
  });
});
