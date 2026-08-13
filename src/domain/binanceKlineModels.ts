import { z } from "zod";
import { invalidRequest } from "./errors";

export const BINANCE_KLINE_INTERVALS = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d"] as const;
export type BinanceKlineInterval = (typeof BINANCE_KLINE_INTERVALS)[number];

export interface BinanceFiveMinuteKlineRequest {
  readonly token: string;
  readonly interval?: BinanceKlineInterval;
  readonly start: string | Date | number;
  readonly end: string | Date | number;
  readonly signal?: AbortSignal;
}

export interface BinanceFiveMinuteKlinePoint {
  readonly timestamp: number;
  readonly priceUsd: string;
}

export interface BinanceFiveMinuteKlineResult {
  readonly provider: "binance";
  readonly symbol: string;
  readonly quoteAsset: "USDT";
  readonly interval: BinanceKlineInterval;
  readonly start: string;
  readonly end: string;
  readonly points: readonly BinanceFiveMinuteKlinePoint[];
}

const inputSchema = z.object({ token: z.string().trim().min(1).max(32), interval: z.enum(BINANCE_KLINE_INTERVALS).optional(), start: z.union([z.string(), z.date(), z.number()]), end: z.union([z.string(), z.date(), z.number()]), signal: z.instanceof(AbortSignal).optional() }).strict();

export function normalizeBinanceFiveMinuteKlineRequest(input: BinanceFiveMinuteKlineRequest): { token: string; symbol: string; interval: BinanceKlineInterval; startMs: number; endMs: number; signal?: AbortSignal } {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw invalidRequest("Invalid Binance 5-minute kline request.");
  const startMs = toMilliseconds(parsed.data.start);
  const endMs = toMilliseconds(parsed.data.end);
  if (endMs <= startMs) throw invalidRequest("Binance kline end must be after start.");
  const token = parsed.data.token.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (token.length === 0) throw invalidRequest("Binance token symbol is invalid.");
  const interval = parsed.data.interval ?? "5m";
  return { token: parsed.data.token, symbol: token + "USDT", interval, startMs, endMs, ...(parsed.data.signal === undefined ? {} : { signal: parsed.data.signal }) };
}

function toMilliseconds(value: string | Date | number): number {
  const milliseconds = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw invalidRequest("Binance kline timestamps must be valid non-negative times.");
  return milliseconds;
}
