import fs from "node:fs";
import path from "node:path";
import axios from "axios";
import type { KlinePoint } from "../../domain/klineModels";
import { KlineBinaryCodec } from "./KlineBinaryCodec";
import type { ArchiveProviderAdapter } from "./ArchiveProviderAdapter";
import { BinanceArchiveAdapter } from "./BinanceArchiveAdapter";
import { GateArchiveAdapter } from "./GateArchiveAdapter";
import { EvmDataError } from "../../domain/errors";

export interface KlineArchiveManagerOptions {
  readonly cacheDir?: string;
  readonly ttlMs?: number; // Default: 24h = 86_400_000 ms
}

class AsyncLock {
  private queue: Promise<void> = Promise.resolve();

  acquire<T>(fn: () => Promise<T>): Promise<T> {
    const res = this.queue.then(fn);
    this.queue = res.then(() => {}, () => {});
    return res;
  }
}

export class KlineArchiveManager {
  private readonly cacheDir: string;
  private readonly ttlMs: number;
  private readonly lock = new AsyncLock();
  private readonly adapters = new Map<"binance" | "gate", ArchiveProviderAdapter>([
    ["binance", new BinanceArchiveAdapter()],
    ["gate", new GateArchiveAdapter()],
  ]);

  constructor(options: KlineArchiveManagerOptions = {}) {
    this.cacheDir = options.cacheDir ?? path.resolve("./data/cache/klines");
    this.ttlMs = options.ttlMs ?? 86_400_000; // 1 day
  }

  /**
   * Retrieves kline points for a completed calendar month.
   * If cached and within 1-day TTL, reads directly from disk.
   * Otherwise, downloads the archive package (with concurrency 1), converts to .bin, and caches on disk.
   */
  async getMonthlyKlines(
    provider: "binance" | "gate",
    symbol: string,
    interval: string,
    year: number,
    month: number,
    startMs?: number,
    endMs?: number,
    signal?: AbortSignal,
  ): Promise<KlinePoint[]> {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new EvmDataError({
        code: "UNSUPPORTED_OPERATION",
        message: `Archive provider "${provider}" is not supported.`,
        retryable: false,
        provider,
      });
    }

    const cleanSymbol = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
    const baseSymbol = cleanSymbol.endsWith("USDT") ? cleanSymbol.slice(0, -4) : cleanSymbol;
    const mm = String(month).padStart(2, "0");
    const filePath = path.join(this.cacheDir, provider, baseSymbol, interval, `${year}-${mm}.bin`);

    // 1. Fast path: check if valid cached .bin file exists
    if (this.isCacheValid(filePath)) {
      try {
        const buffer = fs.readFileSync(filePath);
        return KlineBinaryCodec.decode(buffer, startMs, endMs);
      } catch {
        // Fall back to re-download if file reading fails
      }
    }

    // 2. Slow path: Acquire single-concurrency lock to download and encode
    return this.lock.acquire(async () => {
      // Re-check cache after acquiring lock
      if (this.isCacheValid(filePath)) {
        try {
          const buffer = fs.readFileSync(filePath);
          return KlineBinaryCodec.decode(buffer, startMs, endMs);
        } catch {
          // Continue to download
        }
      }

      if (signal?.aborted) {
        throw new EvmDataError({
          code: "REQUEST_ABORTED",
          message: "Kline archive download was aborted.",
          retryable: false,
          provider,
        });
      }

      const url = adapter.getMonthlyArchiveUrl(baseSymbol, interval, year, month);
      let rawBuffer: Buffer;
      try {
        const res = await axios.get(url, {
          responseType: "arraybuffer",
          timeout: 60_000,
          ...(signal === undefined ? {} : { signal }),
        });
        rawBuffer = Buffer.from(res.data);
      } catch (error: any) {
        if (signal?.aborted) {
          throw new EvmDataError({
            code: "REQUEST_ABORTED",
            message: "Kline archive download was aborted.",
            retryable: false,
            provider,
          });
        }
        throw new EvmDataError({
          code: "PROVIDER_UNAVAILABLE",
          message: `Failed to download kline archive from ${provider} for ${baseSymbol} ${year}-${mm}.`,
          retryable: true,
          provider,
          cause: error,
        });
      }

      // Parse and normalize into points
      const points = adapter.parseArchive(rawBuffer, interval);

      // Encode to compact 16-byte fixed-length binary
      const binaryData = KlineBinaryCodec.encode(points);

      // Write to disk
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, binaryData);
      } catch {
        // Disk write failure is non-fatal for returning current request
      }

      // Trigger background cleanup of expired cache files
      this.cleanExpiredCache();

      return KlineBinaryCodec.decode(binaryData, startMs, endMs);
    });
  }

  /**
   * Checks if the cache file exists and has not exceeded TTL.
   */
  private isCacheValid(filePath: string): boolean {
    try {
      if (!fs.existsSync(filePath)) return false;
      const stat = fs.statSync(filePath);
      return Date.now() - stat.mtimeMs < this.ttlMs;
    } catch {
      return false;
    }
  }

  /**
   * Cleans up cache files older than TTL (24 hours).
   */
  cleanExpiredCache(): void {
    try {
      if (!fs.existsSync(this.cacheDir)) return;
      const now = Date.now();
      cleanDir(this.cacheDir, now, this.ttlMs);
    } catch {
      // Ignore cleanup errors
    }
  }
}

function cleanDir(dir: string, now: number, ttlMs: number): void {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      cleanDir(fullPath, now, ttlMs);
      // Remove empty directory if all files deleted
      try {
        if (fs.readdirSync(fullPath).length === 0) {
          fs.rmdirSync(fullPath);
        }
      } catch {}
    } else if (entry.isFile() && entry.name.endsWith(".bin")) {
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > ttlMs) {
          fs.unlinkSync(fullPath);
        }
      } catch {}
    }
  }
}
