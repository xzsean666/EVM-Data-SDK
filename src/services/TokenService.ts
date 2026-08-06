import type { Erc20BlockRangeResult, Erc20Transfer, Page } from "../domain/models";
import { normalizeErc20BlockRangeRequest, normalizeErc20TransfersRequest, type Erc20BlockRangeRequest, type Erc20TransfersRequest } from "../domain/operations";
import { unsupportedOperation } from "../domain/errors";
import type { TokenPriceAggregationResult } from "../domain/priceModels";
import {
  normalizeTokenPriceHistoryRequest,
  type TokenPriceHistoryRequest,
} from "../domain/priceOperations";
import type { RequestExecutor } from "../execution/RequestExecutor";
import type { BlockRangeScanner } from "../execution/BlockRangeScanner";
import type { TokenPriceAggregator } from "../price/TokenPriceAggregator";

export class TokenService {
  constructor(
    private readonly executor: RequestExecutor,
    private readonly blockRangeScanner: BlockRangeScanner,
    private readonly priceAggregator: TokenPriceAggregator | null = null,
    private readonly tokenAliases: Readonly<Record<string, string>> = {},
  ) {}

  getErc20Transfers(request: Erc20TransfersRequest): Promise<Page<Erc20Transfer>> {
    return this.executor.execute(normalizeErc20TransfersRequest(request));
  }

  getErc20TransfersByBlockRange(request: Erc20BlockRangeRequest): Promise<Erc20BlockRangeResult> {
    return this.blockRangeScanner.scan(normalizeErc20BlockRangeRequest(request));
  }

  getPriceHistory(request: TokenPriceHistoryRequest): Promise<TokenPriceAggregationResult> {
    if (this.priceAggregator === null) {
      return Promise.reject(unsupportedOperation("No token price provider is configured."));
    }
    return this.priceAggregator.getPriceHistory(normalizeTokenPriceHistoryRequest(request, {
      aliases: this.tokenAliases,
    }));
  }
}
