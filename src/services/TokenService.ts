import type { Erc20Transfer, Page } from "../domain/models";
import { normalizeErc20TransfersRequest, type Erc20TransfersRequest } from "../domain/operations";
import { unsupportedOperation } from "../domain/errors";
import type { TokenPriceAggregationResult } from "../domain/priceModels";
import {
  normalizeTokenPriceHistoryRequest,
  type TokenPriceHistoryRequest,
} from "../domain/priceOperations";
import type { RequestExecutor } from "../execution/RequestExecutor";
import type { TokenPriceAggregator } from "../price/TokenPriceAggregator";

export class TokenService {
  constructor(
    private readonly executor: RequestExecutor,
    private readonly priceAggregator: TokenPriceAggregator | null = null,
    private readonly tokenAliases: Readonly<Record<string, string>> = {},
  ) {}

  getErc20Transfers(request: Erc20TransfersRequest): Promise<Page<Erc20Transfer>> {
    return this.executor.execute(normalizeErc20TransfersRequest(request));
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
