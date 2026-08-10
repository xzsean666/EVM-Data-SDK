import { z } from "zod";
import { invalidRequest } from "./errors";

export interface UniswapV3HistoricalPriceRequest {
  readonly chain: 1 | "ethereum";
  readonly blockNumber: string;
  readonly tokenIds?: readonly string[];
  /** Explicit token addresses; matching is order-independent. */
  readonly tokenPair?: readonly [string, string];
  readonly signal?: AbortSignal;
}

export interface NormalizedUniswapV3HistoricalPriceRequest {
  readonly chainId: 1;
  readonly blockNumber: string;
  readonly tokenIds: readonly string[] | null;
  readonly tokenPair: readonly [string, string] | null;
  readonly signal?: AbortSignal;
}

export interface UniswapV3PriceAsset { readonly address: string; readonly symbol: string; readonly decimals: number; }
export type UniswapV3PriceFailureCode = "POOL_NOT_DEPLOYED_AT_BLOCK" | "POOL_CALL_REVERTED" | "SLOT0_RESPONSE_INVALID" | "PRICE_CALCULATION_INVALID";
export interface UniswapV3PriceFailure { readonly tokenId: string; readonly tokenAddress: string; readonly poolAddress: string; readonly code: UniswapV3PriceFailureCode; readonly retryable: false; readonly message: string; }
export interface UniswapV3HistoricalPrice {
  readonly tokenId: string; readonly tokenAddress: string; readonly tokenSymbol: string; readonly tokenDecimals: number;
  readonly poolAddress: string; readonly feeTier: number; readonly token0: UniswapV3PriceAsset; readonly token1: UniswapV3PriceAsset;
  readonly baseToken: UniswapV3PriceAsset; readonly quoteToken: UniswapV3PriceAsset; readonly sqrtPriceX96: string; readonly tick: string;
  readonly price: string; readonly tickPrice: string; readonly ratioNumerator: string; readonly ratioDenominator: string; readonly priceRounding: "floor"; readonly blockNumber: string;
}
export interface UniswapV3HistoricalPriceResult {
  readonly chainId: 1; readonly blockNumber: string; readonly blockHash: string; readonly blockTimestamp: string; readonly registryVersion: string;
  readonly rpcEndpointId: string; readonly executionMode: "multicall3"; readonly priceScale: 18;
  readonly prices: readonly UniswapV3HistoricalPrice[]; readonly failures: readonly UniswapV3PriceFailure[];
  readonly summary: { readonly configuredTokens: number; readonly requestedTokens: number; readonly succeededTokens: number; readonly failedTokens: number; readonly distinctPools: number; readonly multicallBatches: number; readonly partial: boolean; };
}

const requestSchema = z.object({
  chain: z.union([z.literal(1), z.literal("ethereum")]),
  blockNumber: z.string().max(78).regex(/^[0-9]+$/).transform((v) => v.replace(/^0+(?=\d)/, "") || "0"),
  tokenIds: z.array(z.string().trim().min(1).max(256)).min(1).optional(),
  tokenPair: z.tuple([z.string().trim().min(1).max(128), z.string().trim().min(1).max(128)]).optional(),
  signal: z.custom<AbortSignal>((v) => v instanceof AbortSignal).optional(),
}).strict();

export function parseUniswapV3HistoricalPriceRequest(input: unknown): NormalizedUniswapV3HistoricalPriceRequest {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) throw invalidRequest("Invalid Uniswap V3 historical price request.");
  if (parsed.data.tokenIds !== undefined && parsed.data.tokenPair !== undefined) throw invalidRequest("Specify either tokenIds or tokenPair, not both.");
  if (parsed.data.tokenIds !== undefined && new Set(parsed.data.tokenIds).size !== parsed.data.tokenIds.length) throw invalidRequest("Uniswap V3 tokenIds must be unique.");
  if (parsed.data.tokenPair !== undefined && parsed.data.tokenPair[0].toLowerCase() === parsed.data.tokenPair[1].toLowerCase()) throw invalidRequest("Uniswap V3 tokenPair must contain two different tokens.");
  return Object.freeze({ chainId: 1, blockNumber: parsed.data.blockNumber, tokenIds: parsed.data.tokenIds === undefined ? null : Object.freeze(parsed.data.tokenIds), tokenPair: parsed.data.tokenPair === undefined ? null : Object.freeze([parsed.data.tokenPair[0].toLowerCase(), parsed.data.tokenPair[1].toLowerCase()] as [string, string]), ...(parsed.data.signal === undefined ? {} : { signal: parsed.data.signal }) });
}
