import { AxiosHttpTransport, parseHttpProxyUrl } from "../../../transport/AxiosHttpTransport";
import type { HttpTransport } from "../../../transport/HttpTransport";
import { EvmDataError } from "../../../domain/errors";
import type { TokenPriceProviderResult } from "../../../domain/priceModels";
import { addUtcDays, utcStartMilliseconds } from "../../../domain/priceOperations";
import type { NormalizedTokenPriceRequest } from "../../../domain/priceOperations";
import type { PriceProviderAttemptContext, TokenPriceProviderAdapter } from "../../../price/TokenPriceProviderAdapter";
import { classifyBinanceResponse, normalizeBinanceTransportError } from "./binanceErrors";
import { binanceResult, mapBinanceKlines } from "./binanceMapper";
import { binanceExchangeInfoSchema, binanceKlinesSchema } from "./binanceSchemas";

export const BINANCE_SPOT_BASE_URL = "https://api.binance.com";
const CANDLE_CHUNK_DAYS = 1_000;
export interface BinanceAdapterOptions { readonly transport?: HttpTransport; readonly baseUrl?: string; readonly allowInsecureHttp?: boolean; }
export class BinanceAdapter implements TokenPriceProviderAdapter {
  readonly name = "binance" as const;
  private readonly transport: HttpTransport;
  private readonly baseUrl: string;
  constructor(options: BinanceAdapterOptions = {}) { this.transport = options.transport ?? new AxiosHttpTransport(); this.baseUrl = normalizeBaseUrl(options.baseUrl ?? BINANCE_SPOT_BASE_URL, options.allowInsecureHttp ?? false); }
  supports(): boolean { return true; }
  async getPriceHistory(request: NormalizedTokenPriceRequest, context: PriceProviderAttemptContext): Promise<TokenPriceProviderResult> {
    const symbol = request.baseSymbol + "USDT";
    const metadata = await this.call("/api/v3/exchangeInfo", { symbol }, context);
    const parsedMetadata = binanceExchangeInfoSchema.safeParse(metadata);
    const market = parsedMetadata.success ? parsedMetadata.data.symbols.find((candidate) => candidate.symbol === symbol && candidate.status === "TRADING" && candidate.isSpotTradingAllowed !== false) : undefined;
    if (market === undefined) throw new EvmDataError({ code: "MARKET_NOT_FOUND", message: "Binance active Spot USDT market was not found.", retryable: false, provider: this.name });
    const rows = [];
    for (const [startDate, endDate] of chunks(request.resolvedRange.startDate, request.resolvedRange.endDate, CANDLE_CHUNK_DAYS)) {
      const body = await this.call("/api/v3/klines", { symbol, interval: "1d", startTime: utcStartMilliseconds(startDate), endTime: utcStartMilliseconds(addUtcDays(endDate, 1)) - 1, limit: CANDLE_CHUNK_DAYS }, context);
      const parsedRows = binanceKlinesSchema.safeParse(body);
      if (!parsedRows.success) throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Binance returned malformed daily candle data.", retryable: false, provider: this.name });
      rows.push(...parsedRows.data);
    }
    try { return binanceResult(request, mapBinanceKlines(rows, request, context.nowMs)); } catch (error) { throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Binance returned invalid daily candle data.", retryable: false, provider: this.name, cause: error }); }
  }
  private async call(path: string, params: Record<string, string | number>, context: PriceProviderAttemptContext): Promise<unknown> {
    try { const response = await this.transport.request({ method: "GET", url: this.baseUrl + path, params, timeoutMs: context.timeoutMs, ...(context.signal === undefined ? {} : { signal: context.signal }), proxy: context.proxy === null ? null : parseHttpProxyUrl(context.proxy.url) }); const failure = classifyBinanceResponse(response); if (failure !== null) throw failure; return response.body; } catch (error) { if (error instanceof EvmDataError) throw error; throw normalizeBinanceTransportError(error) ?? new EvmDataError({ code: "PROVIDER_UNAVAILABLE", message: "Binance request failed.", retryable: true, provider: this.name }); }
  }
}
function chunks(startDate: string, endDate: string, length: number): readonly (readonly [string, string])[] { const result: [string, string][] = []; for (let start = startDate; start <= endDate; start = addUtcDays(start, length)) { const end = addUtcDays(start, length - 1); result.push([start, end < endDate ? end : endDate]); } return result; }
function normalizeBaseUrl(value: string, allowInsecureHttp: boolean): string { const parsed = new URL(value); const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1"; const allowedProtocol = parsed.protocol === "https:" || (parsed.protocol === "http:" && (allowInsecureHttp || loopback)); if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "" || !allowedProtocol) throw new Error("Binance base URL must be an approved HTTP(S) URL."); return value.replace(/\/$/, ""); }
