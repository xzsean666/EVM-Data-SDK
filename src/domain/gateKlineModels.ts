import { z } from "zod";
import { invalidRequest } from "./errors";

export interface GateKlineRequest { readonly pair: string; readonly start: number; readonly end: number; readonly signal?: AbortSignal }
export interface GateKlinePoint { readonly timestamp: number; readonly priceUsd: string }
const schema = z.object({ pair: z.string().trim().regex(/^[A-Z0-9]{1,30}_USDT$/i), start: z.number().int().nonnegative(), end: z.number().int().nonnegative(), signal: z.instanceof(AbortSignal).optional() }).strict();
export function normalizeGateKlineRequest(input: GateKlineRequest) {
  const parsed = schema.safeParse(input);
  if (!parsed.success || parsed.data.end <= parsed.data.start) throw invalidRequest("Invalid Gate 5-minute kline request.");
  return { pair: parsed.data.pair.toUpperCase(), start: parsed.data.start, end: parsed.data.end, ...(parsed.data.signal === undefined ? {} : { signal: parsed.data.signal }) };
}
