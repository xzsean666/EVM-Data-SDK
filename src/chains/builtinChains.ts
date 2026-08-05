import type { ChainDefinition } from "../domain/chains";
import { freezeChainDefinition, parseChainDefinition } from "../domain/chains";

const definitions = [
  {
    chainId: 1,
    name: "Ethereum",
    alias: "ethereum",
    aliases: ["eth"],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    routes: {
      etherscan: { chainId: "1" },
      alchemy: { httpUrlPrefix: "https://eth-mainnet.g.alchemy.com/v2" },
      moralis: { chain: "0x1" },
    },
  },
  {
    chainId: 56,
    name: "BNB Smart Chain",
    alias: "bsc",
    aliases: ["bnb-smart-chain"],
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    routes: {
      etherscan: { chainId: "56" },
      alchemy: { httpUrlPrefix: "https://bnb-mainnet.g.alchemy.com/v2" },
      moralis: { chain: "0x38" },
    },
  },
  {
    chainId: 137,
    name: "Polygon",
    alias: "polygon",
    aliases: [],
    nativeCurrency: { name: "POL", symbol: "POL", decimals: 18 },
    routes: {
      etherscan: { chainId: "137" },
      alchemy: { httpUrlPrefix: "https://polygon-mainnet.g.alchemy.com/v2" },
      moralis: { chain: "0x89" },
    },
  },
  {
    chainId: 42161,
    name: "Arbitrum One",
    alias: "arbitrum",
    aliases: ["arb"],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    routes: {
      etherscan: { chainId: "42161" },
      alchemy: { httpUrlPrefix: "https://arb-mainnet.g.alchemy.com/v2" },
      moralis: { chain: "0xa4b1" },
    },
  },
  {
    chainId: 8453,
    name: "Base",
    alias: "base",
    aliases: [],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    routes: {
      etherscan: { chainId: "8453" },
      alchemy: { httpUrlPrefix: "https://base-mainnet.g.alchemy.com/v2" },
      moralis: { chain: "0x2105" },
    },
  },
  {
    chainId: 10,
    name: "Optimism",
    alias: "optimism",
    aliases: ["op"],
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    routes: {
      etherscan: { chainId: "10" },
      alchemy: { httpUrlPrefix: "https://opt-mainnet.g.alchemy.com/v2" },
      moralis: { chain: "0xa" },
    },
  },
] as const;

export const BUILTIN_CHAINS: readonly ChainDefinition[] = Object.freeze(
  definitions.map((definition) => parseChainDefinition(definition)),
);

export const builtinChains = BUILTIN_CHAINS;

export function cloneBuiltinChains(): readonly ChainDefinition[] {
  return Object.freeze(BUILTIN_CHAINS.map((chain) => freezeChainDefinition(chain)));
}
