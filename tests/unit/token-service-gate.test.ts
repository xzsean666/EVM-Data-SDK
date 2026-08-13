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
    const fetchMock = vi.fn(async () => new Response(
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
});
