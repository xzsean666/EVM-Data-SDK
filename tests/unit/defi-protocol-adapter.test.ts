import { describe, expect, it } from "vitest";

import { adapterCalls, evaluateAdapter } from "../../src/defi/DeFiProtocolAdapter";
import type { DeFiTokenDefinition } from "../../src/defi/DeFiTokenDefinition";

const token = "0x1111111111111111111111111111111111111111";
const underlying = Object.freeze([{ address: "0x2222222222222222222222222222222222222222", symbol: "UND", decimals: 18, isNative: false }]);
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
function definition(adapter: DeFiTokenDefinition["adapter"], legs = underlying): DeFiTokenDefinition {
  return { id: `ethereum:fixture:${adapter}`, chainId: 1, protocol: "fixture", kind: adapter === "uniswap-v2-lp" ? "lp" : "vault", tokenAddress: token, tokenSymbol: "FIX", tokenDecimals: 18, underlyings: legs, adapter, sampleTokenAmount: "1000000000000000000" };
}
function results(entries: readonly [string, string][]) { return new Map(entries.map(([id, returnData]) => [id, { id, success: true, returnData }])); }

describe("DeFi protocol adapters", () => {
  it("plans and decodes fixed, wstETH, rETH, and ERC-4626 one-leg rates", () => {
    const fixed = definition("fixed-ratio");
    expect(adapterCalls(fixed)).toEqual([]);
    expect(evaluateAdapter(fixed, new Map()).amounts).toEqual([fixed.sampleTokenAmount]);
    for (const adapter of ["wsteth", "rocket-reth", "cbeth", "erc4626"] as const) {
      const item = definition(adapter);
      const calls = adapterCalls(item);
      expect(calls).toHaveLength(1);
      expect(calls[0]!.target).toBe(token);
      expect(evaluateAdapter(item, results([[calls[0]!.id, word(123n)]])).amounts).toEqual(["123"]);
    }
  });

  it("uses exact Compound V2 mantissa arithmetic and exact LP reserve arithmetic", () => {
    const compound = definition("compound-v2");
    const compoundCall = adapterCalls(compound)[0]!;
    expect(evaluateAdapter(compound, results([[compoundCall.id, word(2n * 10n ** 18n)]])).amounts).toEqual(["2000000000000000000"]);
    const lp = definition("uniswap-v2-lp", Object.freeze([underlying[0]!, { address: "0x3333333333333333333333333333333333333333", symbol: "TWO", decimals: 6, isNative: false }]));
    const [reserves, supply] = adapterCalls(lp);
    const reservesData = `0x${10n.toString(16).padStart(64, "0")}${20n.toString(16).padStart(64, "0")}${0n.toString(16).padStart(64, "0")}`;
    expect(evaluateAdapter(lp, results([[reserves!.id, reservesData], [supply!.id, word(2n * 10n ** 18n)]])).amounts).toEqual(["5", "10"]);

    const curve = definition("curve-3pool-lp", Object.freeze([
      { address: "0x1", symbol: "DAI", decimals: 18, isNative: false, chainlinkAssetSymbol: "DAI" },
      { address: "0x2", symbol: "USDC", decimals: 6, isNative: false, chainlinkAssetSymbol: "USDC" },
      { address: "0x3", symbol: "USDT", decimals: 6, isNative: false, chainlinkAssetSymbol: "USDT" },
    ]));
    const curveCalls = adapterCalls(curve);
    expect(curveCalls).toHaveLength(4);
    expect(curveCalls[0]!.target).toBe("0xbEbc44782C7dB0A1A60Cb6Fe97d0b483032FF1C7");
    expect(curveCalls[0]!.callData).toBe("0x4903b0d10000000000000000000000000000000000000000000000000000000000000000");
    expect(evaluateAdapter(curve, results([
      [curveCalls[0]!.id, word(10n)], [curveCalls[1]!.id, word(20n)], [curveCalls[2]!.id, word(30n)], [curveCalls[3]!.id, word(2n * 10n ** 18n)],
    ])).amounts).toEqual(["5", "10", "15"]);
  });

  it("reads Aave normalized income from the chain-specific Pool with ray arithmetic", () => {
    const aave = {
      ...definition("aave-v3"),
      id: "base:fixture:aave-usdc",
      chainId: 8453 as const,
      tokenDecimals: 6,
      sampleTokenAmount: "1000000",
      underlyings: Object.freeze([{ address: "0x2222222222222222222222222222222222222222", symbol: "USDC", decimals: 6, isNative: false, chainlinkAssetSymbol: "USDC" }]),
    } satisfies DeFiTokenDefinition;
    const call = adapterCalls(aave)[0]!;
    expect(call.target).toBe("0xA238Dd80C259a72e81d7e4664a9801593F98d1c5");
    expect(call.callData).toBe("0xd15e00530000000000000000000000002222222222222222222222222222222222222222");
    expect(evaluateAdapter(aave, results([[call.id, word(105n * 10n ** 25n)]])).amounts).toEqual(["1050000"]);
  });

  it("uses the canonical Aave V2 LendingPool address", () => {
    const aaveV2 = {
      ...definition("aave-v2"),
      underlyings: Object.freeze([{ address: "0x2222222222222222222222222222222222222222", symbol: "DAI", decimals: 18, isNative: false, chainlinkAssetSymbol: "DAI" }]),
    } satisfies DeFiTokenDefinition;
    expect(adapterCalls(aaveV2)[0]!.target).toBe("0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9");
  });

  it("decodes Balancer Vault pool tokens and preserves manifest token order", () => {
    const balancer = {
      ...definition("balancer-bpt", Object.freeze([
      { address: "0xba100000625a3754423978a60c9317c58a424e3d", symbol: "BAL", decimals: 18, isNative: false, chainlinkAssetSymbol: "BAL" },
      { address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", symbol: "WETH", decimals: 18, isNative: false, chainlinkAssetSymbol: "ETH" },
      ])),
      adapterTarget: "0xba12222222228d8ba445958a75a0704d566bf2c8",
      adapterPoolId: "5c6ee304399dbdb9c8ef030ab642b10820db8f56000200000000000000000014",
    } satisfies DeFiTokenDefinition;
    const [pool, supply] = adapterCalls(balancer);
    const wordHex = (n: bigint) => n.toString(16).padStart(64, "0");
    const addressWord = (a: string) => a.slice(2).padStart(64, "0");
    const poolData = `0x${wordHex(64n)}${wordHex(160n)}${wordHex(2n)}${addressWord("0xba100000625a3754423978a60c9317c58a424e3d")}${addressWord("0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2")}${wordHex(2n)}${wordHex(10n)}${wordHex(20n)}${wordHex(123n)}`;
    expect(pool!.target).toBe("0xba12222222228d8ba445958a75a0704d566bf2c8");
    expect(evaluateAdapter(balancer, results([[pool!.id, poolData], [supply!.id, word(2n * 10n ** 18n)]])).amounts).toEqual(["5", "10"]);
  });

  it("rejects malformed, empty, and zero protocol return data", () => {
    const vault = definition("erc4626");
    const call = adapterCalls(vault)[0]!;
    expect(() => evaluateAdapter(vault, results([[call.id, "0x"]]))).toThrow();
    expect(() => evaluateAdapter(vault, results([[call.id, word(0n)]]))).toThrow();
    expect(() => evaluateAdapter(vault, results([[call.id, "0x12"]]))).toThrow();
  });
});
