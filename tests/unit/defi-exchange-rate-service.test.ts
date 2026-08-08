import { describe, expect, it, vi } from "vitest";

import { DeFiExchangeRateService, type DeFiMulticallService } from "../../src/defi/DeFiExchangeRateService";
import type { DeFiTokenDefinition } from "../../src/defi/DeFiTokenDefinition";
import { DEFI_TOKEN_REGISTRY } from "../../src/defi/defiTokenRegistry";
import type { MulticallAtBlockRequest, MulticallAtBlockResult } from "../../src/domain/rpcModels";

const TOKEN = "0x1111111111111111111111111111111111111111";
const UNDERLYING = "0x2222222222222222222222222222222222222222";
const word = (value: bigint) => `0x${value.toString(16).padStart(64, "0")}`;
const manifest: readonly DeFiTokenDefinition[] = Object.freeze([
  Object.freeze({ id: "ethereum:fixture:fixed", chainId: 1, protocol: "fixture", kind: "lending", tokenAddress: TOKEN, tokenSymbol: "FIX", tokenDecimals: 18, underlyings: Object.freeze([{ address: UNDERLYING, symbol: "UND", decimals: 18, isNative: false }]), adapter: "fixed-ratio", sampleTokenAmount: "1000000000000000000" }),
  Object.freeze({ id: "ethereum:fixture:vault", chainId: 1, protocol: "fixture", kind: "vault", tokenAddress: "0x3333333333333333333333333333333333333333", tokenSymbol: "VLT", tokenDecimals: 18, underlyings: Object.freeze([{ address: UNDERLYING, symbol: "UND", decimals: 18, isNative: false }]), adapter: "erc4626", sampleTokenAmount: "1000000000000000000", deploymentBlock: "100" }),
  Object.freeze({ id: "base:fixture:lp", chainId: 8453, protocol: "fixture", kind: "lp", tokenAddress: "0x4444444444444444444444444444444444444444", tokenSymbol: "LP", tokenDecimals: 18, underlyings: Object.freeze([{ address: UNDERLYING, symbol: "ONE", decimals: 18, isNative: false }, { address: "0x5555555555555555555555555555555555555555", symbol: "TWO", decimals: 6, isNative: false }]), adapter: "uniswap-v2-lp", sampleTokenAmount: "1000000000000000000" }),
]);

function fakeRpc(results: Readonly<Record<string, { readonly success: boolean; readonly returnData: string }>>) {
  const multicallAtBlock = vi.fn(async (request: MulticallAtBlockRequest): Promise<MulticallAtBlockResult> => Object.freeze({ chainId: request.chain === "base" || request.chain === 8453 ? 8453 : 1, blockNumber: request.blockNumber, blockHash: `0x${"ab".repeat(32)}`, blockTimestamp: "1700000000", rpcEndpointId: "fixture-rpc", multicallBatches: 1, results: Object.freeze(request.calls.map((call) => Object.freeze({ id: call.id, ...(results[call.id] ?? { success: true, returnData: word(1n) }) }))) }));
  return { multicallAtBlock } as DeFiMulticallService & { multicallAtBlock: ReturnType<typeof vi.fn> };
}

describe("DeFiExchangeRateService", () => {
  it("returns fixed and dynamic partial results at one exact normalized block", async () => {
    const rpc = fakeRpc({ "ethereum:fixture:vault::assets": { success: true, returnData: word(123n) } });
    const service = new DeFiExchangeRateService({ rpcServices: new Map([[1, rpc]]), manifest });
    const result = await service.getExchangeRatesAtBlock({ chain: "ethereum", blockNumber: "000100" });
    expect(result.rates.map((rate) => rate.tokenId)).toEqual(["ethereum:fixture:fixed", "ethereum:fixture:vault"]);
    expect(result.rates[1]!.underlyings[0]!.amount).toBe("123");
    expect(result.summary).toMatchObject({ configuredTokens: 2, requestedTokens: 2, succeededTokens: 2, failedTokens: 0, multicallBatches: 1 });
    expect(rpc.multicallAtBlock.mock.calls[0]![0]).toMatchObject({ chain: 1, blockNumber: "100" });
  });

  it("reports protocol reverts and pre-deployment tokens as per-token failures", async () => {
    const rpc = fakeRpc({ "ethereum:fixture:vault::assets": { success: false, returnData: "0x" } });
    const service = new DeFiExchangeRateService({ rpcServices: new Map([[1, rpc]]), manifest });
    const result = await service.getExchangeRatesAtBlock({ chain: 1, blockNumber: "100" });
    expect(result.rates).toHaveLength(1);
    expect(result.failures).toEqual([{ tokenId: "ethereum:fixture:vault", tokenAddress: manifest[1]!.tokenAddress, code: "CALL_REVERTED", retryable: false, message: "Protocol call reverted at the requested block." }]);
    await expect(service.getExchangeRatesAtBlock({ chain: 1, blockNumber: "99", tokenIds: ["ethereum:fixture:vault"] })).rejects.toMatchObject({ code: "DEFI_EXCHANGE_RATE_DATA_UNAVAILABLE" });
  });

  it("keeps LP reserves as two exact integer legs", async () => {
    const reserves = `0x${10n.toString(16).padStart(64, "0")}${20n.toString(16).padStart(64, "0")}${0n.toString(16).padStart(64, "0")}`;
    const rpc = fakeRpc({ "base:fixture:lp::reserves": { success: true, returnData: reserves }, "base:fixture:lp::supply": { success: true, returnData: word(2n * 10n ** 18n) } });
    const service = new DeFiExchangeRateService({ rpcServices: new Map([[8453, rpc]]), manifest });
    const result = await service.getExchangeRatesAtBlock({ chain: "base", blockNumber: "25000000" });
    expect(result.rates[0]!.underlyings.map((leg) => leg.amount)).toEqual(["5", "10"]);
  });

  it("rejects unknown token subsets before RPC work", async () => {
    const rpc = fakeRpc({});
    const service = new DeFiExchangeRateService({ rpcServices: new Map([[1, rpc]]), manifest });
    await expect(service.getExchangeRatesAtBlock({ chain: 1, blockNumber: "100", tokenIds: ["missing"] })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(rpc.multicallAtBlock).not.toHaveBeenCalled();
  });

  it("rejects an all-failure dynamic token subset", async () => {
    const rpc = fakeRpc({ "ethereum:fixture:vault::assets": { success: false, returnData: "0x" } });
    const service = new DeFiExchangeRateService({ rpcServices: new Map([[1, rpc]]), manifest });
    await expect(service.getExchangeRatesAtBlock({ chain: 1, blockNumber: "100", tokenIds: ["ethereum:fixture:vault"] })).rejects.toMatchObject({ code: "DEFI_EXCHANGE_RATE_DATA_UNAVAILABLE" });
  });

  it("submits every configured chain registry call in one Multicall3 request", async () => {
    const multicallAtBlock = vi.fn(async (request: MulticallAtBlockRequest): Promise<MulticallAtBlockResult> => Object.freeze({
      chainId: request.chain === "base" || request.chain === 8453 ? 8453 : 1,
      blockNumber: request.blockNumber,
      blockHash: `0x${"ab".repeat(32)}`,
      blockTimestamp: "1700000000",
      rpcEndpointId: "fixture-rpc",
      multicallBatches: 1,
      results: Object.freeze(request.calls.map((call) => Object.freeze({ id: call.id, success: false, returnData: "0x" }))),
    }));
    const rpc = { multicallAtBlock } satisfies DeFiMulticallService;
    const service = new DeFiExchangeRateService({ rpcServices: new Map([[1, rpc], [8453, rpc]]), manifest: DEFI_TOKEN_REGISTRY });
    for (const chain of [1, 8453] as const) {
      const result = await service.getExchangeRatesAtBlock({ chain, blockNumber: "1" });
      expect(result.summary.multicallBatches).toBe(1);
      expect(result.summary.requestedTokens).toBeGreaterThan(0);
    }
    expect(multicallAtBlock).toHaveBeenCalledTimes(2);
    for (const [request] of multicallAtBlock.mock.calls) {
      expect(request.calls.length).toBeGreaterThan(0);
      expect(new Set(request.calls.map((call) => call.id)).size).toBe(request.calls.length);
    }
  });
});
