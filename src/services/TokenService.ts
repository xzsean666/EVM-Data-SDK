import type { Erc20BalancesAtBlock, Erc20BlockRangeResult, Erc20TokenHoldings, Erc20Transfer, Page } from "../domain/models";
import { normalizeErc20BalancesAtBlockRequest, normalizeErc20BlockRangeRequest, normalizeErc20TokenHoldingsRequest, normalizeErc20TransfersRequest, type Erc20BalancesAtBlockRequest, type Erc20BlockRangeRequest, type Erc20TokenHoldingsRequest, type Erc20TransfersRequest } from "../domain/operations";
import { unsupportedOperation } from "../domain/errors";
import type { TokenPriceAggregationResult } from "../domain/priceModels";
import {
  normalizeTokenPriceHistoryRequest,
  type TokenPriceHistoryRequest,
} from "../domain/priceOperations";
import type { RequestExecutor } from "../execution/RequestExecutor";
import type { BlockRangeScanner } from "../execution/BlockRangeScanner";
import type { TokenPriceAggregator } from "../price/TokenPriceAggregator";
import type { ApiChainService } from "./ApiChainService";
import type { BinanceFiveMinuteKlineRequest, BinanceFiveMinuteKlineResult } from "../domain/binanceKlineModels";
import { normalizeBinanceFiveMinuteKlineRequest } from "../domain/binanceKlineModels";
import type { BinanceAdapter } from "../providers/price/binance/BinanceAdapter";
import type { GateKlineRequest, GateKlinePoint } from "../domain/gateKlineModels";
import { normalizeGateKlineRequest } from "../domain/gateKlineModels";
import type { Erc20MulticallAtBlockRequest, Erc20MulticallAtBlockResult } from "../domain/erc20MulticallModels";
import type { RpcService } from "../rpc/RpcService";

export class TokenService {
  private nextGateEndpoint = 0;
  constructor(
    private readonly executor: RequestExecutor,
    private readonly blockRangeScanner: BlockRangeScanner,
    private readonly indexedApi: ApiChainService,
    private readonly priceAggregator: TokenPriceAggregator | null = null,
    private readonly tokenAliases: Readonly<Record<string, string>> = {},
    private readonly binanceAdapter: BinanceAdapter | null = null,
    private readonly rpcResolver: ((chainId: 1 | 8453) => RpcService | null) | null = null,
  ) {}

  getErc20Transfers(request: Erc20TransfersRequest): Promise<Page<Erc20Transfer>> {
    return this.executor.execute(normalizeErc20TransfersRequest(request));
  }

  getErc20TransfersByBlockRange(request: Erc20BlockRangeRequest): Promise<Erc20BlockRangeResult> {
    const { onWindow, ...rangeRequest } = request;
    return this.blockRangeScanner.scan(normalizeErc20BlockRangeRequest(rangeRequest), onWindow);
  }

  /**
   * API-only historical balances for a caller-supplied set of ERC-20
   * contracts. It never uses RPC and cannot enumerate unknown wallet assets.
   */
  getErc20BalancesAtBlock(request: Erc20BalancesAtBlockRequest): Promise<Erc20BalancesAtBlock> {
    return this.indexedApi.getErc20BalancesAtBlock(
      normalizeErc20BalancesAtBlockRequest(request),
    );
  }

  /** Full current holding metadata for deterministic historic-token discovery. */
  getErc20TokenHoldings(request: Erc20TokenHoldingsRequest): Promise<Erc20TokenHoldings> {
    return this.indexedApi.getErc20TokenHoldings(
      normalizeErc20TokenHoldingsRequest(request),
    );
  }

  /** Batch common ERC-20 view reads through Multicall3 at one exact block. */
  getErc20MulticallAtBlock(request: Erc20MulticallAtBlockRequest): Promise<Erc20MulticallAtBlockResult> {
    const chainId = request.chain === 8453 || request.chain === "base" ? 8453 : 1;
    const rpc = this.rpcResolver?.(chainId);
    if (rpc === null || rpc === undefined) {
      return Promise.reject(unsupportedOperation("Archive RPC is not enabled for ERC-20 multicall reads."));
    }
    return rpc.multicallErc20AtBlock(request);
  }

  multicallErc20AtBlock(request: Erc20MulticallAtBlockRequest): Promise<Erc20MulticallAtBlockResult> {
    return this.getErc20MulticallAtBlock(request);
  }

  getPriceHistory(request: TokenPriceHistoryRequest): Promise<TokenPriceAggregationResult> {
    if (this.priceAggregator === null) {
      return Promise.reject(unsupportedOperation("No token price provider is configured."));
    }
    return this.priceAggregator.getPriceHistory(normalizeTokenPriceHistoryRequest(request, {
      aliases: this.tokenAliases,
    }));
  }

  getBinanceKlines(request: BinanceFiveMinuteKlineRequest): Promise<BinanceFiveMinuteKlineResult> {
    if (this.binanceAdapter === null) return Promise.reject(unsupportedOperation("Binance price provider is not configured."));
    const normalized = normalizeBinanceFiveMinuteKlineRequest(request);
    return this.binanceAdapter.getFiveMinuteKlines(normalized.symbol, normalized.startMs, normalized.endMs, { proxy: null, timeoutMs: 30_000, nowMs: Date.now(), correlationId: "binance-5m", ...(normalized.signal === undefined ? {} : { signal: normalized.signal }) }, normalized.interval).then((points) => Object.freeze({ provider: "binance" as const, symbol: normalized.symbol, quoteAsset: "USDT" as const, interval: normalized.interval, start: new Date(normalized.startMs).toISOString(), end: new Date(normalized.endMs).toISOString(), points }));
  }

  getBinanceKlinesPrices(request: BinanceFiveMinuteKlineRequest): Promise<BinanceFiveMinuteKlineResult["points"]> {
    return this.getBinanceKlines(request).then((result) => result.points);
  }

  async getGateKlinesPrices(request: GateKlineRequest): Promise<readonly GateKlinePoint[]> {
    const normalized = normalizeGateKlineRequest(request);
    const chunks: Array<{ from: number; to: number }> = [];
    const chunkMs = 900 * 5 * 60 * 1000;
    for (let from = normalized.start; from < normalized.end; from += chunkMs) {
      chunks.push({ from, to: Math.min(normalized.end, from + chunkMs) });
    }
    const results: GateKlinePoint[][] = [];
    const configuredEndpoints = (process.env.GATE_API_BASE_URLS?.trim() || "https://api.gateio.ws").split(",").map((value) => value.trim().replace(/\/$/, "")).filter(Boolean);
    const endpoints = [...new Set(configuredEndpoints)].filter((value) => { try { const url = new URL(value); return url.protocol === "https:" && (url.pathname === "" || url.pathname === "/") && url.search === "" && url.hash === ""; } catch { return false; } });
    if (endpoints.length === 0) throw new Error("Gate API endpoint pool is empty.");
    let cursor = 0;
    const worker = async () => {
      for (;;) {
        const index = cursor++;
        const chunk = chunks[index];
        if (!chunk) return;
        const { from, to } = chunk;
      let lastError: unknown;
      const startEndpoint = this.nextGateEndpoint++ % endpoints.length;
      for (let attempt = 0; attempt < endpoints.length; attempt++) {
      const endpoint = endpoints[(startEndpoint + attempt) % endpoints.length]!;
      const url = new URL(endpoint + "/api/v4/spot/candlesticks");
      url.searchParams.set("currency_pair", normalized.pair); url.searchParams.set("interval", "5m");
      url.searchParams.set("from", String(Math.floor(from / 1000))); url.searchParams.set("to", String(Math.floor(to / 1000))); url.searchParams.set("limit", "1000");
      const response = await fetch(url, { headers: { accept: "application/json" }, ...(normalized.signal === undefined ? {} : { signal: normalized.signal }) });
      if (!response.ok) { lastError = new Error(`Gate ${response.status}: ${await response.text()}`); continue; }
      const rows = await response.json() as unknown;
      if (!Array.isArray(rows)) { lastError = new Error("Gate returned malformed candlesticks."); continue; }
      const points: GateKlinePoint[] = [];
      for (const row of rows) {
        if (!Array.isArray(row) || row.length < 6) { lastError = new Error("Gate returned malformed candlestick row."); continue; }
        const point = { timestamp: Number(row[0]) * 1000, priceUsd: String(row[2]) };
        if (Number.isFinite(point.timestamp) && Number(point.priceUsd) > 0) points.push(point);
      }
      results[index] = points;
      lastError = null;
      break;
      }
      if (lastError) throw lastError;
    }
    }
    await Promise.all(Array.from({ length: Math.min(3, chunks.length) }, () => worker()));
    return results.flat().sort((a, b) => a.timestamp - b.timestamp);
  }
}
