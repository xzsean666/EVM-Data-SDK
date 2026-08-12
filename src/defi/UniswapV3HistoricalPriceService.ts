import { invalidRequest, uniswapV3PriceDataUnavailable } from "../domain/errors";
import type { MulticallAtBlockRequest, MulticallAtBlockResult } from "../domain/rpcModels";
import { parseUniswapV3HistoricalPriceRequest, parseUniswapV3TokenPriceAtBlockRequest, parseUniswapV3TokenPricesAtBlockRequest, type UniswapV3HistoricalPriceRequest, type UniswapV3HistoricalPriceResult, type UniswapV3PriceFailure, type UniswapV3HistoricalPrice, type UniswapV3TokenPriceAtBlockRequest, type UniswapV3TokenPriceAtBlockResult, type UniswapV3TokenPricesAtBlockRequest, type UniswapV3TokenPricesAtBlockResult } from "../domain/uniswapV3HistoricalPriceModels";
import type { UniswapV3TokenDefinition } from "./UniswapV3TokenDefinition";
import { UNISWAP_V3_TOKEN_REGISTRY, uniswapV3RegistryVersion } from "./uniswapV3TokenRegistry";
import { decodeUniswapV3Slot0, UNISWAP_V3_SLOT0_SELECTOR } from "./UniswapV3Slot0Codec";
import { ratioForSqrtPrice } from "./UniswapV3PriceMath";

export interface UniswapV3MulticallService { multicallAtBlock(request: MulticallAtBlockRequest): Promise<MulticallAtBlockResult>; }
export interface UniswapV3HistoricalPriceServiceOptions { readonly rpcService: UniswapV3MulticallService; readonly manifest?: readonly UniswapV3TokenDefinition[]; readonly registryVersion?: string; }

export class UniswapV3HistoricalPriceService {
  private readonly rpcService: UniswapV3MulticallService; private readonly manifest: readonly UniswapV3TokenDefinition[]; private readonly version: string;
  constructor(options: UniswapV3HistoricalPriceServiceOptions) { this.rpcService = options.rpcService; this.manifest = options.manifest ?? UNISWAP_V3_TOKEN_REGISTRY; this.version = options.registryVersion ?? uniswapV3RegistryVersion(this.manifest); }

  /**
   * Returns one USD price for a token at an exact block. All configured pools
   * matching the symbol/address are evaluated; the highest resulting price is
   * selected when the token has more than one fee tier.
   *
   * USD stablecoin quotes are treated as USD. WETH quotes are converted using
   * the configured WETH/USDC Uniswap V3 pools at the same block, so the
   * registry remains entirely Uniswap-owned and contains no oracle metadata.
   */
  async getTokenPriceAtBlock(request: UniswapV3TokenPriceAtBlockRequest): Promise<UniswapV3TokenPriceAtBlockResult> {
    const normalized = parseUniswapV3TokenPriceAtBlockRequest(request);
    const batch = await this.getTokenPricesAtBlockUsd({
      chain: normalized.chain,
      blockNumber: normalized.blockNumber,
      tokens: [normalized.token],
      ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
    });
    const result = batch.prices[0];
    if (result === undefined) throw uniswapV3PriceDataUnavailable(`No Uniswap V3 USD price resolved for token "${normalized.token}" at block ${normalized.blockNumber}.`);
    return result;
  }

  /** Resolves many symbols/addresses with one deduplicated Multicall3 request. */
  async getTokenPricesAtBlockUsd(request: UniswapV3TokenPricesAtBlockRequest): Promise<UniswapV3TokenPricesAtBlockResult> {
    const normalized = parseUniswapV3TokenPricesAtBlockRequest(request);
    const requested = normalized.tokens.map((token) => ({
      token,
      candidates: resolveToken(token, this.manifest).filter((definition) => {
        if (!isUsdResolvableDefinition(definition)) return false;
        // WETH itself must be priced from a USD stablecoin pool. Including
        // WETH/UNI, WETH/DAI, etc. would only add unrelated pools and cannot
        // produce a USD result without another oracle hop.
        if (isWeth(definition.tokenAddress)) return isUsdc(definition.quoteTokenAddress) || isUsdt(definition.quoteTokenAddress);
        return true;
      }),
    }));
    const candidates = requested.flatMap(({ candidates: definitions }) => definitions);
    const reference = candidates.some((token) => isWeth(token.quoteTokenAddress))
      ? this.manifest.filter((token) => isWeth(token.tokenAddress) && (isUsdc(token.quoteTokenAddress) || isUsdt(token.quoteTokenAddress)))
      : [];
    const selected = [...new Map([...candidates, ...reference].map((token) => [token.id, token])).values()];
    if (selected.length === 0) {
      throw uniswapV3PriceDataUnavailable(`No Uniswap V3 USD pool is configured for the requested token(s) at block ${normalized.blockNumber}.`);
    }
    const snapshot = await this.getTokenPricesAtBlock({
      chain: normalized.chain,
      blockNumber: normalized.blockNumber,
      tokenIds: selected.map((token) => token.id),
      ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
    });
    const byId = new Map(snapshot.prices.map((price) => [price.tokenId, price]));
    const wethUsd = reference.map((token) => byId.get(token.id)).filter((price): price is UniswapV3HistoricalPrice => price !== undefined).reduce<{ numerator: bigint; denominator: bigint } | null>((highest, price) => {
      const candidate = { numerator: BigInt(price.ratioNumerator), denominator: BigInt(price.ratioDenominator) };
      return highest === null || candidate.numerator * highest.denominator > highest.numerator * candidate.denominator ? candidate : highest;
    }, null);
    const prices: UniswapV3TokenPriceAtBlockResult[] = [];
    const failures: { token: string; message: string }[] = [];
    for (const entry of requested) {
      const resolved = entry.candidates.map((definition) => {
        const price = byId.get(definition.id);
        if (price === undefined) return null;
        const numerator = BigInt(price.ratioNumerator);
        const denominator = BigInt(price.ratioDenominator);
        const usd = isWeth(price.quoteToken.address)
          ? wethUsd === null ? null : { numerator: numerator * wethUsd.numerator, denominator: denominator * wethUsd.denominator }
          : isUsdc(price.quoteToken.address) || isUsdt(price.quoteToken.address) ? { numerator, denominator } : null;
        return usd === null ? null : { definition, price, usd };
      }).filter((value): value is { definition: UniswapV3TokenDefinition; price: UniswapV3HistoricalPrice; usd: { numerator: bigint; denominator: bigint } } => value !== null);
      if (resolved.length === 0) {
        failures.push({ token: entry.token, message: `No Uniswap V3 USD price resolved at block ${normalized.blockNumber}.` });
        continue;
      }
      const highest = resolved.reduce((best, value) => value.usd.numerator * best.usd.denominator > best.usd.numerator * value.usd.denominator ? value : best);
      prices.push(Object.freeze({ chainId: 1, blockNumber: snapshot.blockNumber, blockHash: snapshot.blockHash, blockTimestamp: snapshot.blockTimestamp, token: entry.token, tokenAddress: highest.definition.tokenAddress, tokenSymbol: highest.definition.tokenSymbol, tokenDecimals: highest.definition.tokenDecimals, priceUsd: renderScaled(highest.usd.numerator, highest.usd.denominator), feeTier: highest.definition.feeTier, poolAddress: highest.definition.poolAddress, quoteToken: highest.price.quoteToken, source: "uniswap-v3" }));
    }
    return Object.freeze({ chainId: 1, blockNumber: snapshot.blockNumber, blockHash: snapshot.blockHash, blockTimestamp: snapshot.blockTimestamp, registryVersion: snapshot.registryVersion, rpcEndpointId: snapshot.rpcEndpointId, executionMode: "multicall3", prices: Object.freeze(prices), failures: Object.freeze(failures), summary: Object.freeze({ requestedTokens: requested.length, succeededTokens: prices.length, failedTokens: failures.length, distinctPools: snapshot.summary.distinctPools, multicallBatches: snapshot.summary.multicallBatches, partial: failures.length > 0 }) });
  }

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

const ONE_USD = 10n ** 18n;
const WETH = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const USDC = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const USDT = "0xdac17f958d2ee523a2206206994597c13d831ec7";

function isWeth(address: string): boolean { return address.toLowerCase() === WETH; }
function isUsdc(address: string): boolean { return address.toLowerCase() === USDC; }
function isUsdt(address: string): boolean { return address.toLowerCase() === USDT; }
function isUsdResolvableDefinition(definition: UniswapV3TokenDefinition): boolean {
  return isUsdc(definition.quoteTokenAddress) || isUsdt(definition.quoteTokenAddress) || isWeth(definition.quoteTokenAddress);
}
function renderScaled(numerator: bigint, denominator: bigint): string {
  const value = (numerator * ONE_USD) / denominator;
  const whole = value / ONE_USD;
  const fraction = (value % ONE_USD).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}

function resolveToken(input: string, manifest: readonly UniswapV3TokenDefinition[]): readonly UniswapV3TokenDefinition[] {
  const value = input.toLowerCase();
  const aliases: Record<string, string> = { eth: "weth", btc: "wbtc", avax: "wavax", tao: "wtao" };
  const requested = aliases[value] ?? value;
  if (/^0x[0-9a-f]{40}$/.test(requested)) {
    const matches = manifest.filter((token) => token.tokenAddress.toLowerCase() === requested);
    if (matches.length === 0) throw invalidRequest("The requested Uniswap V3 token address is not configured.");
    return matches;
  }
  const matches = manifest.filter((token) => token.tokenSymbol.toLowerCase() === requested);
  if (matches.length === 0) throw invalidRequest(`The requested Uniswap V3 token symbol "${input}" is not configured.`);
  if (new Set(matches.map((token) => token.tokenAddress.toLowerCase())).size > 1) {
    throw invalidRequest(`The requested Uniswap V3 token symbol "${input}" is ambiguous.`);
  }
  return matches;
}

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
