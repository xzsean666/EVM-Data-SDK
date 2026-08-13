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

export class TokenService {
  constructor(
    private readonly executor: RequestExecutor,
    private readonly blockRangeScanner: BlockRangeScanner,
    private readonly indexedApi: ApiChainService,
    private readonly priceAggregator: TokenPriceAggregator | null = null,
    private readonly tokenAliases: Readonly<Record<string, string>> = {},
    private readonly binanceAdapter: BinanceAdapter | null = null,
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
}
