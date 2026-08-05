import type { ChainDefinition, ChainReference } from "../domain/chains";
import {
  isChainId,
  normalizeChainAlias,
  parseChainDefinition,
} from "../domain/chains";
import { unsupportedChain, invalidConfiguration } from "../domain/errors";
import { BUILTIN_CHAINS } from "./builtinChains";

export class ChainRegistry {
  private readonly chainsById: ReadonlyMap<number, ChainDefinition>;
  private readonly chainIdByAlias: ReadonlyMap<string, number>;
  private readonly orderedChains: readonly ChainDefinition[];

  constructor(customChains: readonly ChainDefinition[] = []) {
    const chains = [...BUILTIN_CHAINS, ...customChains.map((chain) => parseChainDefinition(chain))];
    const chainsById = new Map<number, ChainDefinition>();
    const chainIdByAlias = new Map<string, number>();

    for (const chain of chains) {
      if (chainsById.has(chain.chainId)) {
        throw invalidConfiguration(`Duplicate chain ID ${chain.chainId}.`);
      }

      const aliases = [chain.alias, ...chain.aliases];
      for (const alias of aliases) {
        const normalizedAlias = normalizeChainAlias(alias);
        if (chainIdByAlias.has(normalizedAlias)) {
          throw invalidConfiguration(`Duplicate chain alias ${normalizedAlias}.`);
        }
        chainIdByAlias.set(normalizedAlias, chain.chainId);
      }

      chainsById.set(chain.chainId, chain);
    }

    this.chainsById = chainsById;
    this.chainIdByAlias = chainIdByAlias;
    this.orderedChains = Object.freeze([...chains]);
  }

  resolve(reference: ChainReference): ChainDefinition {
    const chainId = resolveChainId(reference, this.chainIdByAlias);
    const chain = this.chainsById.get(chainId);
    if (chain === undefined) {
      throw unsupportedChain(`Unsupported chain ${formatChainReference(reference)}.`, chainId);
    }
    return chain;
  }

  getByChainId(chainId: number): ChainDefinition | undefined {
    return this.chainsById.get(chainId);
  }

  has(reference: ChainReference): boolean {
    try {
      this.resolve(reference);
      return true;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "UNSUPPORTED_CHAIN") {
        return false;
      }
      throw error;
    }
  }

  list(): readonly ChainDefinition[] {
    return this.orderedChains;
  }
}

function resolveChainId(reference: ChainReference, aliases: ReadonlyMap<string, number>): number {
  if (typeof reference === "number") {
    if (!isChainId(reference)) {
      throw unsupportedChain(`Unsupported chain ${String(reference)}.`, null);
    }
    return reference;
  }

  const normalized = reference.trim().toLowerCase();
  if (/^[0-9]+$/.test(normalized)) {
    try {
      const numeric = BigInt(normalized);
      if (numeric > BigInt(Number.MAX_SAFE_INTEGER) || numeric <= 0n) {
        throw unsupportedChain(`Unsupported chain ${normalized}.`, null);
      }
      return Number(numeric);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "UNSUPPORTED_CHAIN") {
        throw error;
      }
      throw unsupportedChain(`Unsupported chain ${normalized}.`, null);
    }
  }

  const chainId = aliases.get(normalized);
  if (chainId === undefined) {
    throw unsupportedChain(`Unsupported chain ${normalized || "<empty>"}.`, null);
  }
  return chainId;
}

function formatChainReference(reference: ChainReference): string {
  return typeof reference === "string" ? reference.trim().toLowerCase() : String(reference);
}
