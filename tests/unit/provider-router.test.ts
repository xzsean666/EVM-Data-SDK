import { describe, expect, it } from "vitest";

import { ChainRegistry } from "../../src/chains/ChainRegistry";
import { normalizeErc20TransfersRequest, normalizeNativeBalanceRequest, normalizeTransactionsRequest } from "../../src/domain/operations";
import type { CursorIdentity } from "../../src/domain/pagination";
import type { DataProviderAdapter } from "../../src/providers/DataProviderAdapter";
import { AlchemyAdapter } from "../../src/providers/alchemy/AlchemyAdapter";
import { EtherscanAdapter } from "../../src/providers/etherscan/EtherscanAdapter";
import { MoralisAdapter } from "../../src/providers/moralis/MoralisAdapter";
import { ProviderRouter } from "../../src/execution/ProviderRouter";
import { queryFingerprint } from "../../src/execution/cursorCodec";

const address = "0x1234567890abcdef1234567890abcdef12345678";

describe("ProviderRouter", () => {
  it("filters by exact capability and preserves configured priority", () => {
    const nativeRequest = normalizeNativeBalanceRequest({ chain: "ethereum", address });
    const calls: Array<{ provider: string; continuation: boolean }> = [];
    const router = new ProviderRouter(new ChainRegistry(), [
      {
        configurationId: "alchemy-main",
        adapter: adapter("alchemy", ["getNativeBalance"], (capability) => {
          calls.push({ provider: "alchemy", continuation: capability.continuation });
          return capability.chain.chainId === 1;
        }),
      },
      {
        configurationId: "etherscan-main",
        adapter: adapter("etherscan", ["getNativeBalance"]),
      },
      {
        configurationId: "transactions-only",
        adapter: adapter("custom-transactions", ["getTransactions"]),
      },
    ]);

    const candidates = router.route(nativeRequest);
    expect(candidates.map((candidate) => candidate.configurationId)).toEqual([
      "alchemy-main",
      "etherscan-main",
    ]);
    expect(calls).toEqual([{ provider: "alchemy", continuation: false }]);
  });

  it("requires both a declared capability and the corresponding method", () => {
    const request = normalizeNativeBalanceRequest({ chain: 1, address });
    const supportsOnly = {
      name: "supports-only",
      supports: () => true,
    } as DataProviderAdapter;

    expect(() => new ProviderRouter(new ChainRegistry(), [
      { configurationId: "supports-only", adapter: supportsOnly },
    ]).route(request)).toThrowError(expect.objectContaining({ code: "UNSUPPORTED_OPERATION" }));
  });

  it("honors feature predicates such as directional transfer support", () => {
    const directional = normalizeErc20TransfersRequest({
      chain: 1,
      address,
      direction: "incoming",
    });
    const both = normalizeErc20TransfersRequest({
      chain: 1,
      address,
      direction: "both",
    });
    const router = new ProviderRouter(new ChainRegistry(), [{
      configurationId: "directional",
      adapter: adapter("alchemy", ["getErc20Transfers"], (capability) =>
        capability.request.operation === "getErc20Transfers" &&
        capability.request.direction !== "both",
      ),
    }]);

    expect(router.route(directional)).toHaveLength(1);
    expect(() => router.route(both)).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_OPERATION" }),
    );
  });

  it("filters list providers by their page-size capacity and forces Etherscan in full-data mode", () => {
    const router = new ProviderRouter(new ChainRegistry(), [
      { configurationId: "moralis-main", adapter: new MoralisAdapter() },
      { configurationId: "alchemy-main", adapter: new AlchemyAdapter() },
      { configurationId: "etherscan-main", adapter: new EtherscanAdapter() },
    ]);

    const atOneThousand = normalizeErc20TransfersRequest({
      chain: 1,
      address,
      direction: "incoming",
      pageSize: 1_000,
    });
    const aboveAlchemy = normalizeErc20TransfersRequest({
      chain: 1,
      address,
      direction: "incoming",
      pageSize: 1_001,
    });
    const highTransactionPage = normalizeTransactionsRequest({ chain: 1, address, pageSize: 10_000 });
    const fullData = normalizeErc20TransfersRequest({
      chain: 1,
      address,
      direction: "incoming",
      pageSize: 50,
      fullData: true,
    });

    expect(router.route(atOneThousand).map((candidate) => candidate.adapter.name)).toEqual(["alchemy", "etherscan"]);
    expect(router.route(aboveAlchemy).map((candidate) => candidate.adapter.name)).toEqual(["etherscan"]);
    expect(router.route(highTransactionPage).map((candidate) => candidate.adapter.name)).toEqual(["etherscan"]);
    expect(router.route(fullData).map((candidate) => candidate.adapter.name)).toEqual(["etherscan"]);
  });

  it("pins continuation to the original provider configuration", () => {
    const request = normalizeNativeBalanceRequest({ chain: "ethereum", address });
    const identity: CursorIdentity = {
      version: 1,
      operation: request.operation,
      provider: "etherscan",
      providerConfigurationId: "etherscan-main",
      chainId: 1,
      queryFingerprint: queryFingerprint(request, 1),
      providerPageState: { page: 2 },
    };
    const router = new ProviderRouter(new ChainRegistry(), [
      { configurationId: "moralis-main", adapter: adapter("moralis", ["getNativeBalance"]) },
      { configurationId: "etherscan-main", adapter: adapter("etherscan", ["getNativeBalance"]) },
    ]);

    expect(router.routeContinuation(request, identity).configurationId).toBe("etherscan-main");
    expect(() => router.routeContinuation(
      normalizeNativeBalanceRequest({ chain: "ethereum", address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" }),
      identity,
    )).toThrowError(expect.objectContaining({ code: "INVALID_CURSOR" }));
    expect(() => new ProviderRouter(new ChainRegistry(), [
      { configurationId: "moralis-main", adapter: adapter("moralis", ["getNativeBalance"]) },
    ]).routeContinuation(request, identity)).toThrowError(
      expect.objectContaining({ code: "INVALID_CURSOR" }),
    );
  });

  it("reports unknown chains and rejects duplicate provider configuration IDs", () => {
    const router = new ProviderRouter(new ChainRegistry(), [
      { configurationId: "etherscan-main", adapter: adapter("etherscan", ["getNativeBalance"]) },
    ]);
    expect(() => router.route(normalizeNativeBalanceRequest({ chain: 999999, address }))).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_CHAIN" }),
    );
    expect(() => new ProviderRouter(new ChainRegistry(), [
      { configurationId: "same", adapter: adapter("one", ["getNativeBalance"]) },
      { configurationId: "same", adapter: adapter("two", ["getNativeBalance"]) },
    ])).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
  });
});

function adapter(
  name: string,
  operations: readonly string[],
  predicate: (request: Parameters<DataProviderAdapter["supports"]>[0]) => boolean = () => true,
): DataProviderAdapter {
  const result: DataProviderAdapter = {
    name,
    supports: (request) => operations.includes(request.operation) && predicate(request),
  };
  if (operations.includes("getNativeBalance")) {
    result.getNativeBalance = async () => {
      throw new Error("test adapter should not perform network work");
    };
  }
  if (operations.includes("getTransactions")) {
    result.getTransactions = async () => {
      throw new Error("test adapter should not perform network work");
    };
  }
  if (operations.includes("getErc20Transfers")) {
    result.getErc20Transfers = async () => {
      throw new Error("test adapter should not perform network work");
    };
  }
  return result;
}
