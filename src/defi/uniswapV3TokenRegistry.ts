import { createHash } from "node:crypto";
import type { UniswapV3TokenDefinition } from "./UniswapV3TokenDefinition";

const weth = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const usdc = "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48";
const usdt = "0xdac17f958d2ee523a2206206994597c13d831ec7";
const xaut = "0x68749665ff8d2d112fa859aa293f07a622782f38";
const tslaon = "0xf6b1117ec07684d3958cad8beb1b302bfd21103f";
const nvdaon = "0x2d1f7226bd1f780af6b9a49dcc0ae00e8df4bdee";
const asset = (address: string, symbol: string, decimals: number) => Object.freeze({ address, symbol, decimals });
const definition = (input: Omit<UniswapV3TokenDefinition, "chainId" | "protocol">): UniswapV3TokenDefinition => Object.freeze({
  ...input, chainId: 1, protocol: "uniswap-v3" as const,
});

export const UNISWAP_V3_TOKEN_REGISTRY_VERSION = "ethereum-uniswap-v3-v2";
export const UNISWAP_V3_TOKEN_REGISTRY: readonly UniswapV3TokenDefinition[] = Object.freeze([
  definition({
    id: "ethereum:uniswap-v3:weth-usdc-500", tokenAddress: weth, tokenSymbol: "WETH", tokenDecimals: 18,
    poolAddress: "0x88e6a0c2ddd26feeb64f039a2c41296fcb3f5640", feeTier: 500,
    token0: asset(usdc, "USDC", 6), token1: asset(weth, "WETH", 18), quoteTokenAddress: usdc, poolDeploymentBlock: "12369621",
  }),
  definition({
    id: "ethereum:uniswap-v3:weth-usdc-3000", tokenAddress: weth, tokenSymbol: "WETH", tokenDecimals: 18,
    poolAddress: "0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8", feeTier: 3000,
    token0: asset(usdc, "USDC", 6), token1: asset(weth, "WETH", 18), quoteTokenAddress: usdc, poolDeploymentBlock: "12369621",
  }),
  definition({
    id: "ethereum:uniswap-v3:xaut-usdt-500", tokenAddress: xaut, tokenSymbol: "XAUt", tokenDecimals: 6,
    poolAddress: "0x6546055f46e866a4b9a4a13e81273e3152bae5da", feeTier: 500,
    token0: asset(xaut, "XAUt", 6), token1: asset(usdt, "USDT", 6), quoteTokenAddress: usdt, poolDeploymentBlock: "13663032",
  }),
  definition({
    id: "ethereum:uniswap-v3:tslaon-usdc-10000", tokenAddress: tslaon, tokenSymbol: "TSLAon", tokenDecimals: 18,
    poolAddress: "0x31227b50eccdc9c589826aa2d9e7c5619b1895da", feeTier: 10000,
    token0: asset(usdc, "USDC", 6), token1: asset(tslaon, "TSLAon", 18), quoteTokenAddress: usdc, poolDeploymentBlock: "23375681",
  }),
  definition({
    id: "ethereum:uniswap-v3:nvdaon-usdc-10000", tokenAddress: nvdaon, tokenSymbol: "NVDAon", tokenDecimals: 18,
    poolAddress: "0xf5294094bce435bfbd0ec488be5c462aaf32bc7a", feeTier: 10000,
    token0: asset(nvdaon, "NVDAon", 18), token1: asset(usdc, "USDC", 6), quoteTokenAddress: usdc, poolDeploymentBlock: "23375836",
  }),
]);

export function uniswapV3RegistryVersion(manifest: readonly UniswapV3TokenDefinition[] = UNISWAP_V3_TOKEN_REGISTRY): string {
  const canonical = manifest.map((e) => `${e.id}|${e.tokenAddress}|${e.poolAddress}|${e.feeTier}|${e.token0.address}|${e.token1.address}|${e.quoteTokenAddress}|${e.poolDeploymentBlock}`).sort().join("\n");
  return `${UNISWAP_V3_TOKEN_REGISTRY_VERSION}:${createHash("sha256").update(canonical).digest("hex").slice(0, 16)}`;
}

export function validateUniswapV3TokenRegistry(manifest: readonly UniswapV3TokenDefinition[]): void {
  const ids = new Set<string>(); const pools = new Set<string>();
  for (const entry of manifest) {
    if (!/^ethereum:uniswap-v3:[a-z0-9-]+$/.test(entry.id) || ids.has(entry.id)) throw new Error("Invalid or duplicate Uniswap V3 token id."); ids.add(entry.id);
    for (const address of [entry.tokenAddress, entry.poolAddress, entry.token0.address, entry.token1.address, entry.quoteTokenAddress]) if (!/^0x[0-9a-f]{40}$/.test(address)) throw new Error("Invalid Uniswap V3 address.");
    if (entry.token0.address === entry.token1.address || entry.tokenAddress !== entry.token0.address && entry.tokenAddress !== entry.token1.address) throw new Error("Invalid Uniswap V3 token side.");
    if (entry.quoteTokenAddress !== (entry.tokenAddress === entry.token0.address ? entry.token1.address : entry.token0.address)) throw new Error("Invalid Uniswap V3 quote side.");
    if (!Number.isInteger(entry.feeTier) || entry.feeTier <= 0 || entry.feeTier > 1_000_000 || !Number.isInteger(entry.token0.decimals) || !Number.isInteger(entry.token1.decimals) || entry.token0.decimals < 0 || entry.token0.decimals > 255 || entry.token1.decimals < 0 || entry.token1.decimals > 255 || !/^[0-9]+$/.test(entry.poolDeploymentBlock)) throw new Error("Invalid Uniswap V3 metadata.");
    const identity = `${entry.poolAddress}|${entry.tokenAddress}|${entry.quoteTokenAddress}|${entry.feeTier}`; if (pools.has(identity)) throw new Error("Duplicate Uniswap V3 pool identity."); pools.add(identity);
  }
}
validateUniswapV3TokenRegistry(UNISWAP_V3_TOKEN_REGISTRY);
