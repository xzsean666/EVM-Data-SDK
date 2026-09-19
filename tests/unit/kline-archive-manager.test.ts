import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";
import { BinanceArchiveAdapter } from "../../src/price/archive/BinanceArchiveAdapter";
import { GateArchiveAdapter } from "../../src/price/archive/GateArchiveAdapter";
import { KlineArchiveManager } from "../../src/price/archive/KlineArchiveManager";
import { KlineBinaryCodec } from "../../src/price/archive/KlineBinaryCodec";

function createTestZip(fileName: string, content: string): Buffer {
  const fileBuf = Buffer.from(content, "utf-8");
  const compBuf = zlib.deflateRawSync(fileBuf);
  const fileNameBuf = Buffer.from(fileName, "utf-8");

  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0); // sig
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(8, 8); // deflate
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(0, 12);
  header.writeUInt32LE(0, 14);
  header.writeUInt32LE(compBuf.length, 18); // comp size
  header.writeUInt32LE(fileBuf.length, 22); // uncomp size
  header.writeUInt16LE(fileNameBuf.length, 26);
  header.writeUInt16LE(0, 28);

  return Buffer.concat([header, fileNameBuf, compBuf]);
}

function createTestGz(content: string): Buffer {
  return zlib.gzipSync(Buffer.from(content, "utf-8"));
}

describe("Archive Adapters & KlineArchiveManager", () => {
  const testCacheDir = path.resolve("./data/test-cache-klines");

  beforeEach(() => {
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(testCacheDir)) {
      fs.rmSync(testCacheDir, { recursive: true, force: true });
    }
    vi.restoreAllMocks();
  });

  it("BinanceArchiveAdapter generates correct URL and parses ZIP CSV", () => {
    const adapter = new BinanceArchiveAdapter();
    const url = adapter.getMonthlyArchiveUrl("BTC", "5m", 2024, 1);
    expect(url).toBe("https://data.binance.vision/data/spot/monthly/klines/BTCUSDT/5m/BTCUSDT-5m-2024-01.zip");

    const csvContent = [
      "1704067200000,42283.58,42397.23,42261.02,42397.23,155.25,1704067499999,6572925,6350,106.05,4490262,0",
      "1704067500000,42397.22,42432.74,42385.26,42409.96,141.31,1704067799999,5993374,5134,69.45,2945451,0",
    ].join("\n");
    const zipBuf = createTestZip("BTCUSDT-5m-2024-01.csv", csvContent);

    const points = adapter.parseArchive(zipBuf);
    expect(points.length).toBe(2);
    expect(points[0]).toEqual({ timestamp: 1704067200000, priceUsd: "42397.23" });
    expect(points[1]).toEqual({ timestamp: 1704067500000, priceUsd: "42409.96" });
  });

  it("GateArchiveAdapter generates correct URL and parses GZ CSV", () => {
    const adapter = new GateArchiveAdapter();
    const url = adapter.getMonthlyArchiveUrl("BTC", "5m", 2024, 1);
    expect(url).toBe("https://download.gatedata.org/spot/candlesticks_5m/202401/BTC_USDT-202401.csv.gz");

    // Gate CSV: [timestampSec, volume, close, high, low, open]
    const csvContent = [
      "1704067200,10.5,42397.23,42480,42200,42280",
      "1704067500,8.2,42409.96,42450,42300,42397",
    ].join("\n");
    const gzBuf = createTestGz(csvContent);

    const points = adapter.parseArchive(gzBuf, "5m");
    expect(points.length).toBe(2);
    expect(points[0]).toEqual({ timestamp: 1704067200000, priceUsd: "42397.23" });
    expect(points[1]).toEqual({ timestamp: 1704067500000, priceUsd: "42409.96" });
  });

  it("downloads, converts to .bin, caches on disk, and respects 1-day TTL", async () => {
    const manager = new KlineArchiveManager({
      cacheDir: testCacheDir,
      ttlMs: 86_400_000,
    });

    const csvContent = "1704067200000,10,15,5,12.5,100,1704067499999,0,0,0,0,0\n";
    const zipBuf = createTestZip("BTCUSDT-5m-2024-01.csv", csvContent);

    let getCalls = 0;
    vi.spyOn(axios, "get").mockImplementation(async () => {
      getCalls++;
      return { data: zipBuf } as any;
    });

    // First call: downloads and creates .bin file
    const points = await manager.getMonthlyKlines("binance", "BTC", "5m", 2024, 1);
    expect(points.length).toBe(1);
    expect(points[0]).toEqual({ timestamp: 1704067200000, priceUsd: "12.5" });
    expect(getCalls).toBe(1);

    const binFile = path.join(testCacheDir, "binance", "BTC", "5m", "2024-01.bin");
    expect(fs.existsSync(binFile)).toBe(true);

    // Second call: should read from cache (getCalls remains 1)
    const points2 = await manager.getMonthlyKlines("binance", "BTC", "5m", 2024, 1);
    expect(points2.length).toBe(1);
    expect(getCalls).toBe(1);

    // Slicing test: range after timestamp returns empty
    const points3 = await manager.getMonthlyKlines("binance", "BTC", "5m", 2024, 1, 1800000000000, 1900000000000);
    expect(points3.length).toBe(0);
  });

  it("cleans up expired cache files older than 24 hours", async () => {
    const manager = new KlineArchiveManager({
      cacheDir: testCacheDir,
      ttlMs: 1000, // 1 second TTL for testing
    });

    const binFile = path.join(testCacheDir, "binance", "BTC", "5m", "2024-01.bin");
    fs.mkdirSync(path.dirname(binFile), { recursive: true });
    fs.writeFileSync(binFile, Buffer.alloc(16));

    // Initially exists
    expect(fs.existsSync(binFile)).toBe(true);

    // Artificially change mtime to 2 seconds ago
    const pastTime = (Date.now() - 2000) / 1000;
    fs.utimesSync(binFile, pastTime, pastTime);

    manager.cleanExpiredCache();

    // Should be deleted
    expect(fs.existsSync(binFile)).toBe(false);
  });
});
