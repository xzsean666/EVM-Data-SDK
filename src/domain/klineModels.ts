import { z } from "zod";
import { invalidRequest } from "./errors";

export const KLINE_INTERVALS = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
] as const;

export type KlineInterval = (typeof KLINE_INTERVALS)[number];

export interface KlineRequest {
  readonly token: string;
  readonly interval?: KlineInterval;
  readonly start: string | Date | number;
  readonly end: string | Date | number;
  readonly signal?: AbortSignal;
}

export interface KlinePoint {
  readonly timestamp: number;
  readonly priceUsd: string;
}

export interface KlineResult {
  readonly provider: "binance" | "gate";
  readonly symbol: string;
  readonly quoteAsset: "USDT";
  readonly interval: KlineInterval;
  readonly start: string;
  readonly end: string;
  readonly points: readonly KlinePoint[];
}

export interface NormalizedKlineRequest {
  readonly token: string;
  readonly baseSymbol: string;
  readonly interval: KlineInterval;
  readonly startMs: number;
  readonly endMs: number;
  readonly signal?: AbortSignal;
}

const inputSchema = z
  .object({
    token: z.string().trim().min(1).max(32),
    interval: z.enum(KLINE_INTERVALS).optional(),
    start: z.union([z.string(), z.date(), z.number()]),
    end: z.union([z.string(), z.date(), z.number()]),
    signal: z.instanceof(AbortSignal).optional(),
  })
  .strict();

export function normalizeKlineRequest(input: KlineRequest): NormalizedKlineRequest {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidRequest("Invalid kline request.");
  }
  const startMs = toMilliseconds(parsed.data.start);
  const endMs = toMilliseconds(parsed.data.end);
  if (endMs <= startMs) {
    throw invalidRequest("Kline end must be after start.");
  }
  const rawToken = parsed.data.token.trim().toUpperCase();
  let baseSymbol = rawToken;
  if (baseSymbol.endsWith("_USDT") && baseSymbol.length > 5) {
    baseSymbol = baseSymbol.slice(0, -5);
  } else if (baseSymbol.endsWith("USDT") && baseSymbol.length > 4) {
    baseSymbol = baseSymbol.slice(0, -4);
  }
  baseSymbol = baseSymbol.replace(/[^A-Z0-9_]/g, "");
  if (baseSymbol.length === 0) {
    throw invalidRequest("Token symbol is invalid.");
  }
  const interval = parsed.data.interval ?? "5m";
  return {
    token: rawToken,
    baseSymbol,
    interval,
    startMs,
    endMs,
    ...(parsed.data.signal === undefined ? {} : { signal: parsed.data.signal }),
  };
}

function toMilliseconds(value: string | Date | number): number {
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(value);
  if (!Number.isSafeInteger(ms) || ms < 0) {
    throw invalidRequest("Kline timestamps must be valid non-negative times.");
  }
  return ms;
}
