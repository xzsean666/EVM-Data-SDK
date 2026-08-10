import { invalidRequest, uniswapV3PriceDataUnavailable } from "../domain/errors";
import type { MulticallAtBlockRequest, MulticallAtBlockResult } from "../domain/rpcModels";
import { parseUniswapV3HistoricalPriceRequest, type UniswapV3HistoricalPriceRequest, type UniswapV3HistoricalPriceResult, type UniswapV3PriceFailure, type UniswapV3HistoricalPrice } from "../domain/uniswapV3HistoricalPriceModels";
import type { UniswapV3TokenDefinition } from "./UniswapV3TokenDefinition";
import { UNISWAP_V3_TOKEN_REGISTRY, uniswapV3RegistryVersion } from "./uniswapV3TokenRegistry";
import { decodeUniswapV3Slot0, UNISWAP_V3_SLOT0_SELECTOR } from "./UniswapV3Slot0Codec";
import { ratioForSqrtPrice } from "./UniswapV3PriceMath";

export interface UniswapV3MulticallService { multicallAtBlock(request: MulticallAtBlockRequest): Promise<MulticallAtBlockResult>; }
export interface UniswapV3HistoricalPriceServiceOptions { readonly rpcService: UniswapV3MulticallService; readonly manifest?: readonly UniswapV3TokenDefinition[]; readonly registryVersion?: string; }

export class UniswapV3HistoricalPriceService {
  private readonly rpcService: UniswapV3MulticallService; private readonly manifest: readonly UniswapV3TokenDefinition[]; private readonly version: string;
  constructor(options: UniswapV3HistoricalPriceServiceOptions) { this.rpcService = options.rpcService; this.manifest = options.manifest ?? UNISWAP_V3_TOKEN_REGISTRY; this.version = options.registryVersion ?? uniswapV3RegistryVersion(this.manifest); }
  async getTokenPricesAtBlock(request: UniswapV3HistoricalPriceRequest): Promise<UniswapV3HistoricalPriceResult> {
    const normalized = parseUniswapV3HistoricalPriceRequest(request);
    const configured = this.manifest;
    const byId = new Map(configured.map((token) => [token.id, token]));
    let selected: UniswapV3TokenDefinition[];
    if (normalized.tokenPair !== null) {
      const pair = resolvePair(normalized.tokenPair, configured);
      selected = configured.filter((token) => pair.has(token.token0.address) && pair.has(token.token1.address));
      if (selected.length === 0) throw invalidRequest("The requested Uniswap V3 token pair is not configured.");
    } else {
      selected = normalized.tokenIds === null ? [...configured] : normalized.tokenIds.map((id) => { const token = byId.get(id); if (token === undefined) throw invalidRequest("A requested Uniswap V3 tokenId is not configured."); return token; });
    }
    const preDeployment = selected.filter((token) => BigInt(normalized.blockNumber) < BigInt(token.poolDeploymentBlock));
    const eligible = selected.filter((token) => !preDeployment.includes(token));
    const failures: UniswapV3PriceFailure[] = preDeployment.map((token) => failure(token, "POOL_NOT_DEPLOYED_AT_BLOCK", "Pool is not deployed at the requested block."));
    if (eligible.length === 0) throw uniswapV3PriceDataUnavailable("No requested Uniswap V3 pool is deployed at this block.");
    const pools = [...new Map(eligible.map((token) => [token.poolAddress, token])).values()];
    const rpcResult = await this.rpcService.multicallAtBlock({ chain: 1, blockNumber: normalized.blockNumber, calls: pools.map((token) => ({ id: `uniswap-v3::${token.poolAddress.toLowerCase()}`, target: token.poolAddress, callData: UNISWAP_V3_SLOT0_SELECTOR, allowFailure: true })), ...(normalized.signal === undefined ? {} : { signal: normalized.signal }) });
    const resultById = new Map(rpcResult.results.map((result) => [result.id, result]));
    const prices: UniswapV3HistoricalPrice[] = [];
    for (const token of eligible) {
      const call = resultById.get(`uniswap-v3::${token.poolAddress.toLowerCase()}`);
      if (call === undefined || !call.success) { failures.push(failure(token, "POOL_CALL_REVERTED", "Pool slot0 call reverted at the requested block.")); continue; }
      let slot;
      try { slot = decodeUniswapV3Slot0(call.returnData); }
      catch { failures.push(failure(token, "SLOT0_RESPONSE_INVALID", "Pool slot0 response is invalid.")); continue; }
      try {
        const baseIsToken0 = token.tokenAddress === token.token0.address;
        const ratios = ratioForSqrtPrice(slot.sqrtPriceX96, slot.tick, baseIsToken0, token.token0.decimals, token.token1.decimals);
        const baseToken = baseIsToken0 ? token.token0 : token.token1; const quoteToken = baseIsToken0 ? token.token1 : token.token0;
        prices.push(Object.freeze({ tokenId: token.id, tokenAddress: token.tokenAddress, tokenSymbol: token.tokenSymbol, tokenDecimals: token.tokenDecimals, poolAddress: token.poolAddress, feeTier: token.feeTier, token0: token.token0, token1: token.token1, baseToken, quoteToken, sqrtPriceX96: slot.sqrtPriceX96.toString(), tick: slot.tick.toString(), price: ratios.spot.display, tickPrice: ratios.tick.display, ratioNumerator: ratios.spot.numerator.toString(), ratioDenominator: ratios.spot.denominator.toString(), priceRounding: "floor", blockNumber: normalized.blockNumber }));
      } catch { failures.push(failure(token, "PRICE_CALCULATION_INVALID", "Pool response could not be converted into a valid price.")); }
    }
    if (prices.length === 0) throw uniswapV3PriceDataUnavailable("No requested Uniswap V3 price resolved at this block.");
    return Object.freeze({ chainId: 1, blockNumber: normalized.blockNumber, blockHash: rpcResult.blockHash, blockTimestamp: rpcResult.blockTimestamp, registryVersion: this.version, rpcEndpointId: rpcResult.rpcEndpointId, executionMode: "multicall3", priceScale: 18, prices: Object.freeze(prices), failures: Object.freeze(failures), summary: Object.freeze({ configuredTokens: configured.length, requestedTokens: selected.length, succeededTokens: prices.length, failedTokens: failures.length, distinctPools: pools.length, multicallBatches: rpcResult.multicallBatches, partial: failures.length > 0 }) });
  }
}
function failure(token: UniswapV3TokenDefinition, code: UniswapV3PriceFailure["code"], message: string): UniswapV3PriceFailure { return Object.freeze({ tokenId: token.id, tokenAddress: token.tokenAddress, poolAddress: token.poolAddress, code, retryable: false, message }); }

function resolvePair(input: readonly [string, string], configured: readonly UniswapV3TokenDefinition[]): Set<string> {
  const values = input.map((value) => value.toLowerCase());
  const addresses = new Set<string>();
  for (const value of values) {
    if (/^0x[0-9a-f]{40}$/.test(value)) { addresses.add(value); continue; }
    const matches = new Set<string>();
    for (const token of configured) {
      if (token.token0.symbol.toLowerCase() === value) matches.add(token.token0.address);
      if (token.token1.symbol.toLowerCase() === value) matches.add(token.token1.address);
    }
    if (matches.size !== 1) throw invalidRequest(matches.size === 0 ? "A requested Uniswap V3 token is not configured." : "A requested Uniswap V3 token symbol is ambiguous.");
    addresses.add([...matches][0]!);
  }
  if (addresses.size !== 2) throw invalidRequest("Uniswap V3 tokenPair must resolve to two different tokens.");
  return addresses;
}
