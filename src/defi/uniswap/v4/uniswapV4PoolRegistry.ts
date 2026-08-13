import type { UniswapV4PoolDefinition } from "./UniswapV4PoolDefinition";
import type { UniswapV4Currency } from "../../../domain/uniswapV4HistoricalPriceModels";

// Static manifest only. Every non-placeholder PoolId must be verified against
// PoolManager.Initialize and StateView; see POOL_ID_DISCOVERY.md.
export const UNISWAP_V4_TOKEN_REGISTRY_VERSION = "ethereum-uniswap-v4-v1";
const zeroHooks = "0x0000000000000000000000000000000000000000";
const usdc: UniswapV4Currency = { address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", kind: "erc20", symbol: "USDC", decimals: 6 };
const usdt: UniswapV4Currency = { address: "0xdac17f958d2ee523a2206206994597c13d831ec7", kind: "erc20", symbol: "USDT", decimals: 6 };
const astr: UniswapV4Currency = { address: "0xf27441230eadeac85b764610325cc9a0d7859689", kind: "erc20", symbol: "ASTR", decimals: 18 };
const weth: UniswapV4Currency = { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", kind: "erc20", symbol: "WETH", decimals: 18 };
const dai: UniswapV4Currency = { address: "0x6b175474e89094c44da98b954eedeac495271d0f", kind: "erc20", symbol: "DAI", decimals: 18 };
const wbtc: UniswapV4Currency = { address: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", kind: "erc20", symbol: "WBTC", decimals: 8 };

export const UNISWAP_V4_TOKEN_REGISTRY: readonly UniswapV4PoolDefinition[] = Object.freeze<readonly UniswapV4PoolDefinition[]>([
  { id: "ethereum:uniswap-v4:astr-usdc", chainId: 1, protocol: "uniswap-v4", tokenAddress: astr.address, tokenSymbol: "ASTR", tokenDecimals: 18, currency0: usdc, currency1: astr, fee: 150000, tickSpacing: 1500, hooks: "0x000000000000000000e1cdf458d9af257c6441980", poolId: "0xd469b123a48fbc668b6cc17f74a63b2422418a1c2cf29d81cce8b3d242912415", quoteCurrencyAddress: usdc.address, poolDeploymentBlock: "25707989", stateSource: "state-view", verification: "verified" },
  { id: "ethereum:uniswap-v4:weth-usdc", chainId: 1, protocol: "uniswap-v4", tokenAddress: weth.address, tokenSymbol: "WETH", tokenDecimals: 18, currency0: usdc, currency1: weth, fee: 0, tickSpacing: 0, hooks: zeroHooks, poolId: "0xe500210c7ea6bfd9f69dce044b09ef384ec2b34832f132baec3b418208e3a657", quoteCurrencyAddress: usdc.address, poolDeploymentBlock: "999999999999999999", stateSource: "state-view", verification: "candidate" },
  { id: "ethereum:uniswap-v4:usdc-usdt", chainId: 1, protocol: "uniswap-v4", tokenAddress: usdc.address, tokenSymbol: "USDC", tokenDecimals: 6, currency0: usdc, currency1: usdt, fee: 0, tickSpacing: 0, hooks: zeroHooks, poolId: "0x0fb0e40cec3bb23e13abc585958a93c796fbea56955e19a23727a716a0423239", quoteCurrencyAddress: usdt.address, poolDeploymentBlock: "999999999999999999", stateSource: "state-view", verification: "candidate" },
  { id: "ethereum:uniswap-v4:dai-usdt", chainId: 1, protocol: "uniswap-v4", tokenAddress: dai.address, tokenSymbol: "DAI", tokenDecimals: 18, currency0: dai, currency1: usdt, fee: 0, tickSpacing: 0, hooks: zeroHooks, poolId: "0xf6e8088529094bc485561fa2a03e3d19c9a60f5d99a997e8fe16ab4ca2db277a", quoteCurrencyAddress: usdt.address, poolDeploymentBlock: "999999999999999999", stateSource: "state-view", verification: "candidate" },
  { id: "ethereum:uniswap-v4:wbtc-usdc", chainId: 1, protocol: "uniswap-v4", tokenAddress: wbtc.address, tokenSymbol: "WBTC", tokenDecimals: 8, currency0: usdc, currency1: wbtc, fee: 0, tickSpacing: 0, hooks: zeroHooks, poolId: "0xb98437c7ba28c6590dd4e1cc46aa89eed181f97108e5b6221730d41347bc817f", quoteCurrencyAddress: usdc.address, poolDeploymentBlock: "999999999999999999", stateSource: "state-view", verification: "candidate" },
]);

export function uniswapV4RegistryVersion(manifest: readonly UniswapV4PoolDefinition[] = UNISWAP_V4_TOKEN_REGISTRY): string {
  return `${UNISWAP_V4_TOKEN_REGISTRY_VERSION}:${manifest.length}`;
}
