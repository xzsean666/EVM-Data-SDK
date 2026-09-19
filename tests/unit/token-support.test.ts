import { describe, expect, it, vi } from "vitest";
import { SqliteStorageAdapter } from "../../src/storage/StorageAdapter";
import { TokenSupportStore } from "../../src/storage/TokenSupportStore";
import { TokenSupportService } from "../../src/price/TokenSupportService";
import type { HttpTransport, HttpRequest, HttpResponse } from "../../src/transport/HttpTransport";

class MockHttpTransport implements HttpTransport {
  constructor(private readonly handler: (req: HttpRequest) => HttpResponse | Promise<HttpResponse>) {}
  async request(req: HttpRequest): Promise<HttpResponse> {
    return this.handler(req);
  }
}

describe("TokenSupportStore & TokenSupportService", () => {
  it("persists and retrieves token support from SQLite", async () => {
    const storage = new SqliteStorageAdapter(":memory:");
    await storage.initialize();
    const store = new TokenSupportStore(storage);

    store.set("BTC", "binance", true);
    store.set("ETH", "gate", true);
    store.set("SCAM", "binance", false);

    const btc = await store.get("BTC", "binance");
    expect(btc).toEqual({
      token: "BTC",
      provider: "binance",
      supported: true,
      updatedAt: expect.any(String),
    });

    const scam = await store.get("SCAM", "binance");
    expect(scam?.supported).toBe(false);

    const all = await store.loadAll();
    expect(all.length).toBe(3);

    await storage.close();
  });

  it("checks support with memory -> sqlite -> 1s probe flow", async () => {
    const storage = new SqliteStorageAdapter(":memory:");
    await storage.initialize();
    const store = new TokenSupportStore(storage);

    let probeCount = 0;
    const transport = new MockHttpTransport((req) => {
      probeCount++;
      if (req.url.includes("api.binance.com/api/v3/exchangeInfo")) {
        const symbol = req.params?.symbol;
        if (symbol === "BTCUSDT") {
          return {
            status: 200,
            headers: {},
            body: {
              symbols: [{ symbol: "BTCUSDT", status: "TRADING", isSpotTradingAllowed: true }],
            },
          };
        }
        if (symbol === "INVALIDUSDT") {
          return {
            status: 400,
            headers: {},
            body: { code: -1121, msg: "Invalid symbol." },
          };
        }
      }
      if (req.url.includes("api.gateio.ws/api/v4/spot/currency_pairs/ETH_USDT")) {
        return {
          status: 200,
          headers: {},
          body: { id: "ETH_USDT", trade_status: "tradable" },
        };
      }
      if (req.url.includes("api.gateio.ws/api/v4/spot/currency_pairs/UNKNOWN_USDT")) {
        return {
          status: 404,
          headers: {},
          body: { label: "CURRENCY_PAIR_NOT_FOUND" },
        };
      }
      return { status: 500, headers: {}, body: {} };
    });

    const service = new TokenSupportService(store, { transport });
    await service.initialize();

    // 1. First probe for BTC on Binance -> true
    const btcSupported = await service.isTokenSupported("BTC", "binance");
    expect(btcSupported).toBe(true);
    expect(probeCount).toBe(1);

    // Second check should hit memory cache (probeCount unchanged)
    const btcAgain = await service.isTokenSupported("BTC", "binance");
    expect(btcAgain).toBe(true);
    expect(probeCount).toBe(1);

    // Verify written to SQLite
    const persistedBtc = await store.get("BTC", "binance");
    expect(persistedBtc?.supported).toBe(true);

    // 2. Probe for INVALID on Binance -> false (definite 400)
    const invalidSupported = await service.isTokenSupported("INVALID", "binance");
    expect(invalidSupported).toBe(false);
    expect(probeCount).toBe(2);

    const persistedInvalid = await store.get("INVALID", "binance");
    expect(persistedInvalid?.supported).toBe(false);

    // 3. Probe Gate for ETH -> true
    const ethGate = await service.isTokenSupported("ETH", "gate");
    expect(ethGate).toBe(true);

    // 4. Probe Gate for UNKNOWN -> false (definite 404)
    const unknownGate = await service.isTokenSupported("UNKNOWN", "gate");
    expect(unknownGate).toBe(false);

    await storage.close();
  });

  it("does NOT cache timeouts or 5xx uncertain responses to SQLite", async () => {
    const storage = new SqliteStorageAdapter(":memory:");
    await storage.initialize();
    const store = new TokenSupportStore(storage);

    const transport = new MockHttpTransport((req) => {
      // Simulate timeout / network error
      throw new Error("Request timeout exceeded 1000ms");
    });

    const service = new TokenSupportService(store, { transport });
    await service.initialize();

    const supported = await service.isTokenSupported("TIMEOUT_TOKEN", "binance");
    expect(supported).toBe(false);

    // MUST NOT be saved to SQLite
    const persisted = await store.get("TIMEOUT_TOKEN", "binance");
    expect(persisted).toBeNull();

    await storage.close();
  });

  it("preloads supported spot tokens into memory and SQLite", async () => {
    const storage = new SqliteStorageAdapter(":memory:");
    await storage.initialize();
    const store = new TokenSupportStore(storage);

    const transport = new MockHttpTransport((req) => {
      if (req.url.includes("api.binance.com/api/v3/exchangeInfo")) {
        return {
          status: 200,
          headers: {},
          body: {
            symbols: [
              { symbol: "BTCUSDT", status: "TRADING", isSpotTradingAllowed: true },
              { symbol: "ETHUSDT", status: "TRADING", isSpotTradingAllowed: true },
              { symbol: "SUSPENDEDUSDT", status: "BREAK", isSpotTradingAllowed: false },
            ],
          },
        };
      }
      if (req.url.includes("api.gateio.ws/api/v4/spot/currency_pairs")) {
        return {
          status: 200,
          headers: {},
          body: [
            { id: "GT_USDT", trade_status: "tradable" },
            { id: "HALTED_USDT", trade_status: "untradable" },
          ],
        };
      }
      return { status: 404, headers: {}, body: {} };
    });

    const service = new TokenSupportService(store, { transport });
    await service.preloadSupportedTokens();

    expect(await service.isTokenSupported("BTC", "binance")).toBe(true);
    expect(await service.isTokenSupported("ETH", "binance")).toBe(true);
    expect(await service.isTokenSupported("SUSPENDED", "binance")).toBe(false);
    expect(await service.isTokenSupported("GT", "gate")).toBe(true);
    expect(await service.isTokenSupported("HALTED", "gate")).toBe(false);

    const btcRecord = await store.get("BTC", "binance");
    expect(btcRecord?.supported).toBe(true);

    const gtRecord = await store.get("GT", "gate");
    expect(gtRecord?.supported).toBe(true);

    await storage.close();
  });
});
