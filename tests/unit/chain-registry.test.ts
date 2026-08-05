import { describe, expect, it } from "vitest";

import { ChainRegistry } from "../../src/chains/ChainRegistry";
import { BUILTIN_CHAINS } from "../../src/chains/builtinChains";
import type { ChainDefinition } from "../../src/domain/chains";

describe("ChainRegistry", () => {
  it("resolves all six built-ins by canonical alias, convenience alias, and ID", () => {
    const registry = new ChainRegistry();

    expect(registry.list()).toHaveLength(6);
    expect(registry.resolve("ethereum").chainId).toBe(1);
    expect(registry.resolve("ETH").chainId).toBe(1);
    expect(registry.resolve("bnb-smart-chain").chainId).toBe(56);
    expect(registry.resolve("op").chainId).toBe(10);
    expect(registry.resolve("137").alias).toBe("polygon");
    expect(registry.resolve(8453).alias).toBe("base");
  });

  it("merges a custom chain and preserves provider route metadata", () => {
    const registry = new ChainRegistry([
      {
        chainId: 9001,
        name: "Local EVM",
        alias: "local-evm",
        aliases: ["local"],
        nativeCurrency: { name: "Local Ether", symbol: "Leth", decimals: 18 },
        routes: {
          etherscan: { chainId: "9001" },
          moralis: { chain: "0x2329" },
        },
      },
    ]);

    const chain = registry.resolve("LOCAL");
    expect(chain).toMatchObject({
      chainId: 9001,
      alias: "local-evm",
      routes: { etherscan: { chainId: "9001" } },
    });
    expect(registry.getByChainId(9001)).toBe(chain);
    expect(registry.has("local")).toBe(true);
  });

  it("rejects duplicate IDs and aliases instead of overriding built-ins", () => {
    expect(() => new ChainRegistry([duplicateChain({ chainId: 1, alias: "custom-one" })])).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
    expect(() => new ChainRegistry([duplicateChain({ chainId: 9000, alias: "ethereum" })])).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
    expect(() => new ChainRegistry([duplicateChain({ chainId: 9000, alias: "same", aliases: ["same"] })])).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
    expect(() =>
      new ChainRegistry([
        duplicateChain({
          chainId: 9000,
          alias: "mismatched-route",
          routes: { etherscan: { chainId: "9001" } },
        }),
      ]),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
  });

  it("returns frozen definitions and rejects unknown chains with a typed error", () => {
    const registry = new ChainRegistry();
    const chain = registry.resolve("ethereum");

    expect(Object.isFrozen(chain)).toBe(true);
    expect(Object.isFrozen(chain.nativeCurrency)).toBe(true);
    expect(Object.isFrozen(chain.routes)).toBe(true);
    expect(Object.isFrozen(chain.aliases)).toBe(true);
    expect(() => ((chain as { name: string }).name = "changed")).toThrow();
    expect(() => registry.resolve("not-a-chain")).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_CHAIN" }),
    );
    expect(registry.has("not-a-chain")).toBe(false);
  });

  it("does not expose mutable built-in definitions", () => {
    expect(BUILTIN_CHAINS).toHaveLength(6);
    expect(Object.isFrozen(BUILTIN_CHAINS)).toBe(true);
    expect(Object.isFrozen(BUILTIN_CHAINS[0])).toBe(true);
  });
});

function duplicateChain(overrides: Partial<ChainDefinition>): ChainDefinition {
  return {
    chainId: 9000,
    name: "Duplicate Test Chain",
    alias: "duplicate-test",
    aliases: [],
    nativeCurrency: { name: "Test Ether", symbol: "TETH", decimals: 18 },
    routes: { etherscan: { chainId: "9000" } },
    ...overrides,
  };
}
