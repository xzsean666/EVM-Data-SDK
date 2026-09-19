import { describe, expect, it, vi } from "vitest";
import { UnifiedKlineService, getOverlappingCalendarMonths } from "../../src/price/UnifiedKlineService";
import type { TokenSupportService } from "../../src/price/TokenSupportService";
import type { KlineArchiveManager } from "../../src/price/archive/KlineArchiveManager";
import { normalizeKlineRequest } from "../../src/domain/klineModels";

describe("UnifiedKlineService", () => {
  it("computes overlapping calendar months correctly", () => {
    // 2024-01-15 to 2024-03-10
    const startMs = Date.UTC(2024, 0, 15);
    const endMs = Date.UTC(2024, 2, 10);
    const months = getOverlappingCalendarMonths(startMs, endMs);
    expect(months).toEqual([
      [2024, 1],
      [2024, 2],
      [2024, 3],
    ]);

    // Single month
    const startSingle = Date.UTC(2024, 5, 1);
    const endSingle = Date.UTC(2024, 5, 20);
    expect(getOverlappingCalendarMonths(startSingle, endSingle)).toEqual([[2024, 6]]);
  });

  it("prioritizes Binance when token is supported by Binance", async () => {
    const mockTokenSupport: Partial<TokenSupportService> = {
      isTokenSupported: vi.fn().mockImplementation(async (token, provider) => {
        if (provider === "binance") return true;
        return true;
      }),
    };

    const mockArchiveManager: Partial<KlineArchiveManager> = {
      getMonthlyKlines: vi.fn().mockResolvedValue([
        { timestamp: 1000, priceUsd: "100" },
      ]),
    };

    const service = new UnifiedKlineService(
      mockTokenSupport as TokenSupportService,
      mockArchiveManager as KlineArchiveManager,
    );

    const request = normalizeKlineRequest({
      token: "BTC",
      start: 1000,
      end: 2000,
      interval: "5m",
    });

    const result = await service.getKlines(request);
    expect(result.provider).toBe("binance");
    expect(result.symbol).toBe("BTCUSDT");
    expect(mockTokenSupport.isTokenSupported).toHaveBeenCalledWith("BTC", "binance", undefined);
  });

  it("falls back to Gate when Binance does not support the token", async () => {
    const mockTokenSupport: Partial<TokenSupportService> = {
      isTokenSupported: vi.fn().mockImplementation(async (token, provider) => {
        if (provider === "binance") return false;
        if (provider === "gate") return true;
        return false;
      }),
    };

    const mockArchiveManager: Partial<KlineArchiveManager> = {
      getMonthlyKlines: vi.fn().mockResolvedValue([
        { timestamp: 1000, priceUsd: "50" },
      ]),
    };

    const service = new UnifiedKlineService(
      mockTokenSupport as TokenSupportService,
      mockArchiveManager as KlineArchiveManager,
    );

    const request = normalizeKlineRequest({
      token: "GATE_ONLY",
      start: 1000,
      end: 2000,
      interval: "5m",
    });

    const result = await service.getKlines(request);
    expect(result.provider).toBe("gate");
    expect(result.symbol).toBe("GATE_ONLY_USDT");
  });

  it("throws TOKEN_NOT_FOUND when neither Binance nor Gate supports the token", async () => {
    const mockTokenSupport: Partial<TokenSupportService> = {
      isTokenSupported: vi.fn().mockResolvedValue(false),
    };

    const mockArchiveManager: Partial<KlineArchiveManager> = {
      getMonthlyKlines: vi.fn(),
    };

    const service = new UnifiedKlineService(
      mockTokenSupport as TokenSupportService,
      mockArchiveManager as KlineArchiveManager,
    );

    const request = normalizeKlineRequest({
      token: "UNSUPPORTED",
      start: 1000,
      end: 2000,
      interval: "5m",
    });

    await expect(service.getKlines(request)).rejects.toThrow("Token \"UNSUPPORTED\" is not supported by Binance or Gate.");
  });

  it("seamlessly merges archive points (< current month) and recent REST points (>= current month)", async () => {
    const now = new Date();
    const currentMonthStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);

    const pastTs = currentMonthStartMs - 86_400_000 * 5; // 5 days into past month
    const recentTs = currentMonthStartMs + 86_400_000 * 2; // 2 days into current month

    const mockTokenSupport: Partial<TokenSupportService> = {
      isTokenSupported: vi.fn().mockResolvedValue(true),
    };

    const mockArchiveManager: Partial<KlineArchiveManager> = {
      getMonthlyKlines: vi.fn().mockResolvedValue([
        { timestamp: pastTs, priceUsd: "100" },
      ]),
    };

    const service = new UnifiedKlineService(
      mockTokenSupport as TokenSupportService,
      mockArchiveManager as KlineArchiveManager,
    );

    // Mock fetchRecentBinance by stubbing internal method
    vi.spyOn(service as any, "fetchRecentBinance").mockResolvedValue([
      { timestamp: recentTs, priceUsd: "105" },
    ]);

    const request = normalizeKlineRequest({
      token: "BTC",
      start: pastTs - 1000,
      end: recentTs + 1000,
      interval: "5m",
    });

    const result = await service.getKlines(request);
    expect(result.points.length).toBe(2);
    expect(result.points[0]).toEqual({ timestamp: pastTs, priceUsd: "100" });
    expect(result.points[1]).toEqual({ timestamp: recentTs, priceUsd: "105" });
  });
});
