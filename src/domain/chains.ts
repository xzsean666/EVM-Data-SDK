import { z } from "zod";

import { invalidConfiguration } from "./errors";

export type BuiltinProviderName = "etherscan" | "blockscout" | "alchemy" | "moralis";
export type ProviderName = BuiltinProviderName | (string & {});

export interface NativeCurrency {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
}

export interface EtherscanRoute {
  readonly chainId: string;
}

export interface AlchemyRoute {
  readonly httpUrlPrefix: string;
}

export interface MoralisRoute {
  readonly chain: string;
}

/** Etherscan-compatible Blockscout API endpoint for one chain. */
export interface BlockscoutRoute {
  readonly apiUrl: string;
}

export interface ChainRoutes {
  readonly etherscan?: EtherscanRoute;
  readonly blockscout?: BlockscoutRoute;
  readonly alchemy?: AlchemyRoute;
  readonly moralis?: MoralisRoute;
}

export interface ChainDefinition {
  readonly chainId: number;
  readonly name: string;
  readonly alias: string;
  readonly aliases: readonly string[];
  readonly nativeCurrency: NativeCurrency;
  readonly routes: ChainRoutes;
}

export type ChainReference = number | string;

const aliasPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const decimalStringPattern = /^(?:0|[1-9][0-9]*)$/;

const routeSchema = z.object({
  etherscan: z
    .object({
      chainId: z.string().regex(decimalStringPattern),
    })
    .strict()
    .optional(),
  blockscout: z
    .object({
      apiUrl: z.string().url(),
    })
    .strict()
    .optional(),
  alchemy: z
    .object({
      httpUrlPrefix: z.string().url(),
    })
    .strict()
    .optional(),
  moralis: z
    .object({
      chain: z.string().trim().min(1).max(128),
    })
    .strict()
    .optional(),
}).strict();

export const chainDefinitionSchema = z
  .object({
    chainId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    name: z.string().trim().min(1).max(128),
    alias: z.string().trim().toLowerCase().regex(aliasPattern),
    aliases: z
      .array(z.string().trim().toLowerCase().regex(aliasPattern))
      .max(32)
      .default([]),
    nativeCurrency: z
      .object({
        name: z.string().trim().min(1).max(64),
        symbol: z.string().trim().min(1).max(16),
        decimals: z.number().int().min(0).max(255),
      })
      .strict(),
    routes: routeSchema,
  })
  .strict();

export function parseChainDefinition(input: unknown): ChainDefinition {
  const parsed = chainDefinitionSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidConfiguration("Invalid chain definition.");
  }

  const chain = parsed.data;
  const allAliases = [chain.alias, ...chain.aliases];
  if (new Set(allAliases).size !== allAliases.length) {
    throw invalidConfiguration(`Chain ${chain.alias} contains duplicate aliases.`);
  }

  if (
    chain.routes.alchemy !== undefined &&
    !isAllowedProviderUrl(chain.routes.alchemy.httpUrlPrefix)
  ) {
    throw invalidConfiguration(`Chain ${chain.alias} has an invalid Alchemy route URL.`);
  }

  if (
    chain.routes.blockscout !== undefined &&
    !isAllowedProviderUrl(chain.routes.blockscout.apiUrl)
  ) {
    throw invalidConfiguration(`Chain ${chain.alias} has an invalid Blockscout route URL.`);
  }

  if (
    chain.routes.etherscan !== undefined &&
    BigInt(chain.routes.etherscan.chainId) !== BigInt(chain.chainId)
  ) {
    throw invalidConfiguration(`Chain ${chain.alias} has an inconsistent Etherscan chain ID.`);
  }

  const routes = {
    ...(chain.routes.etherscan === undefined ? {} : { etherscan: chain.routes.etherscan }),
    ...(chain.routes.blockscout === undefined ? {} : { blockscout: chain.routes.blockscout }),
    ...(chain.routes.alchemy === undefined ? {} : { alchemy: chain.routes.alchemy }),
    ...(chain.routes.moralis === undefined ? {} : { moralis: chain.routes.moralis }),
  };
  return freezeChainDefinition({ ...chain, routes });
}

export function normalizeChainAlias(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!aliasPattern.test(normalized)) {
    throw invalidConfiguration("Chain aliases must use lowercase letters, digits, and hyphens.");
  }
  return normalized;
}

export function freezeChainDefinition(chain: ChainDefinition): ChainDefinition {
  const nativeCurrency = Object.freeze({ ...chain.nativeCurrency });
  const routes = Object.freeze({
    ...(chain.routes.etherscan === undefined
      ? {}
      : { etherscan: Object.freeze({ ...chain.routes.etherscan }) }),
    ...(chain.routes.blockscout === undefined
      ? {}
      : { blockscout: Object.freeze({ ...chain.routes.blockscout }) }),
    ...(chain.routes.alchemy === undefined
      ? {}
      : { alchemy: Object.freeze({ ...chain.routes.alchemy }) }),
    ...(chain.routes.moralis === undefined
      ? {}
      : { moralis: Object.freeze({ ...chain.routes.moralis }) }),
  });

  return Object.freeze({
    ...chain,
    aliases: Object.freeze([...chain.aliases]),
    nativeCurrency,
    routes,
  });
}

function isAllowedProviderUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

export function isChainId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}
