import { describe, expect, it } from "vitest";

import { ChainRegistry } from "../../src/chains/ChainRegistry";
import { normalizeErc20BlockRangeRequest, parseErc20TransfersRequest, parseNativeBalanceRequest, parseTransactionsRequest } from "../../src/domain/operations";
import type { ProviderAttemptContext } from "../../src/providers/DataProviderAdapter";
import { EtherscanAdapter } from "../../src/providers/etherscan/EtherscanAdapter";
import type { HttpRequest, HttpResponse, HttpTransport } from "../../src/transport/HttpTransport";
import {
  etherscanBalanceSuccess,
  etherscanInvalidKey,
  etherscanPlanRestricted,
  etherscanRateLimited,
  etherscanTokenTransfersSuccess,
  etherscanTransactionsEmpty,
  etherscanTransactionsSuccess,
  etherscanTransactionsVariants,
  etherscanUnsupportedChain,
} from "../fixtures/etherscan";

class FixtureTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly body: unknown, private readonly status = 200, private readonly headers: Record<string, string> = {}) {}
  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    return { status: this.status, headers: this.headers, body: this.body };
  }
}

function context(overrides: Partial<ProviderAttemptContext> = {}): ProviderAttemptContext {
  return {
    chain: new ChainRegistry().resolve("ethereum"),
    credential: { id: "key-1", value: "secret-key" },
    proxy: null,
    timeoutMs: 1_000,
    correlationId: "test",
    ...overrides,
  };
}

describe("EtherscanAdapter", () => {
  it("supports list pages through 10,000 records", () => {
    const adapter = new EtherscanAdapter({ transport: new FixtureTransport(etherscanTransactionsSuccess) });
    const chain = new ChainRegistry().resolve("ethereum");
    expect(adapter.supports({ operation: "getTransactions", chain, request: parseTransactionsRequest({ chain: 1, address: "0x1111111111111111111111111111111111111111", pageSize: 10_000 }), continuation: false })).toBe(true);
  });

  it("maps transactions, canonicalizes quantities, and preserves fixed page filters", async () => {
    const transport = new FixtureTransport(etherscanTransactionsSuccess);
    const adapter = new EtherscanAdapter({ transport });
    const request = parseTransactionsRequest({
      chain: "ethereum",
      address: "0x1111111111111111111111111111111111111111",
      pageSize: 1,
      order: "asc",
      startBlock: "0001",
      endBlock: "999",
    });

    const result = await adapter.getTransactions(request, context());
    expect(result.items[0]).toMatchObject({
      blockNumber: "123",
      value: "1000",
      timestamp: "2023-11-14T22:13:20.000Z",
      status: "success",
      to: "0x2222222222222222222222222222222222222222",
    });
    expect(result.nextPageState).toEqual({ page: 2 });
    expect(transport.requests[0]?.params).toMatchObject({
      module: "account",
      action: "txlist",
      chainid: "1",
      page: 1,
      offset: 1,
      sort: "asc",
      startblock: "1",
      endblock: "999",
      apikey: "secret-key",
    });
    expect(transport.requests[0]?.url).toBe("https://api.etherscan.io/v2/api");
  });

  it("treats documented empty transaction responses as successful terminal pages", async () => {
    const result = await new EtherscanAdapter({ transport: new FixtureTransport(etherscanTransactionsEmpty) })
      .getTransactions(parseTransactionsRequest({ chain: 1, address: "0x1111111111111111111111111111111111111111" }), context());
    expect(result.items).toEqual([]);
    expect(result.nextPageState).toBeNull();
  });

  it("maps contract creation, reverted status, unknown status, and missing optional fields", async () => {
    const result = await new EtherscanAdapter({ transport: new FixtureTransport(etherscanTransactionsVariants) })
      .getTransactions(parseTransactionsRequest({ chain: 1, address: "0x1111111111111111111111111111111111111111", pageSize: 2 }), context());
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({ to: null, status: "reverted", timestamp: null, gasLimit: null });
    expect(result.items[1]).toMatchObject({ to: null, status: "unknown", timestamp: null });
    expect(result.nextPageState).toEqual({ page: 2 });
  });

  it("maps latest native balance using chain metadata", async () => {
    const result = await new EtherscanAdapter({ transport: new FixtureTransport(etherscanBalanceSuccess) })
      .getNativeBalance(parseNativeBalanceRequest({ chain: "ethereum", address: "0x1111111111111111111111111111111111111111" }), context());
    expect(result).toMatchObject({ address: "0x1111111111111111111111111111111111111111", amount: "123", decimals: 18, symbol: "ETH", blockNumber: null });
  });

  it("filters ERC-20 transfers by direction after mapping", async () => {
    const transport = new FixtureTransport(etherscanTokenTransfersSuccess);
    const request = parseErc20TransfersRequest({
      chain: 1,
      address: "0x4444444444444444444444444444444444444444",
      direction: "incoming",
      pageSize: 1,
    });
    const result = await new EtherscanAdapter({ transport }).getErc20Transfers(request, context());
    expect(result.items[0]).toMatchObject({ amount: "99", tokenDecimals: 18, logIndex: "3" });
    expect(result.nextPageState).toEqual({ page: 2 });
    expect(transport.requests[0]?.params).toMatchObject({ action: "tokentx", page: 1, offset: 1, sort: "desc" });
  });

  it("uses a fresh ascending closed range request and marks a full Etherscan page incomplete", async () => {
    const fullPage = {
      status: "1",
      message: "OK",
      result: Array.from({ length: 10_000 }, (_, index) => ({
        blockNumber: "42",
        hash: "0x" + String(index).padStart(64, "0"),
        transactionHash: "0x" + String(index).padStart(64, "0"),
        logIndex: String(index),
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        contractAddress: "0x5555555555555555555555555555555555555555",
        value: "1",
      })),
    };
    const transport = new FixtureTransport(fullPage);
    const result = await new EtherscanAdapter({ transport }).getErc20TransfersByBlockRangeWindow(
      normalizeErc20BlockRangeRequest({
        chain: 1,
        address: "0x1111111111111111111111111111111111111111",
        startBlock: "40",
        endBlock: "42",
        direction: "outgoing",
      }),
      context(),
    );
    expect(result.complete).toBe(false);
    expect(result.items).toHaveLength(10_000);
    expect(transport.requests[0]?.params).toMatchObject({ action: "tokentx", page: 1, offset: 10_000, sort: "asc", startblock: "40", endblock: "42" });
  });

  it("maps an empty provider token-decimal field to null", async () => {
    const body = {
      status: "1",
      message: "OK",
      result: [{
        blockNumber: "1",
        timeStamp: "",
        hash: "0xAAA",
        transactionHash: "0xBBB",
        logIndex: "0",
        from: "0x1111111111111111111111111111111111111111",
        to: "0x2222222222222222222222222222222222222222",
        contractAddress: "0x5555555555555555555555555555555555555555",
        value: "1",
        tokenName: "Token",
        tokenSymbol: "TOK",
        tokenDecimal: "",
      }],
    };
    const result = await new EtherscanAdapter({ transport: new FixtureTransport(body) }).getErc20Transfers(
      parseErc20TransfersRequest({ chain: 1, address: "0x1111111111111111111111111111111111111111" }),
      context(),
    );
    expect(result.items[0]?.tokenDecimals).toBeNull();
  });

  it("maps address-scoped internal native transfers through the indexed account API", async () => {
    const transport = new FixtureTransport({
      status: "1",
      message: "OK",
      result: [{
        blockNumber: "00042",
        timeStamp: "1700000000",
        hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        from: "0x2222222222222222222222222222222222222222",
        to: "0x1111111111111111111111111111111111111111",
        value: "000100",
        traceId: "0_1",
        type: "call",
        isError: "0",
      }],
    });
    const result = await new EtherscanAdapter({ transport }).getInternalNativeTransfersByBlockRange({
      address: "0x1111111111111111111111111111111111111111",
      startBlock: "40",
      endBlock: "42",
    }, context());
    expect(result).toMatchObject({ provider: "etherscan", pages: 1, upstreamRequests: 1 });
    expect(result.items[0]).toMatchObject({ blockNumber: "42", value: "100", traceId: "0_1", status: "success" });
    expect(transport.requests[0]?.params).toMatchObject({ action: "txlistinternal", startblock: "40", endblock: "42", page: 1, offset: 10_000, sort: "asc" });
  });

  it("maps Ethereum Beacon withdrawals as Gwei without using an RPC endpoint", async () => {
    const transport = new FixtureTransport({
      status: "1",
      message: "OK",
      result: [{
        withdrawalIndex: "0007",
        validatorIndex: "42",
        blockNumber: "123",
        timestamp: "1700000000",
        address: "0x1111111111111111111111111111111111111111",
        amount: "32000000000",
      }],
    });
    const result = await new EtherscanAdapter({ transport }).getBeaconWithdrawalsByBlockRange({
      address: "0x1111111111111111111111111111111111111111",
      startBlock: "120",
      endBlock: "123",
    }, context());
    expect(result.items[0]).toMatchObject({ withdrawalIndex: "7", amount: "32000000000", amountDecimals: 9, blockNumber: "123" });
    expect(transport.requests[0]?.params).toMatchObject({ action: "txsBeaconWithdrawal", startblock: "120", endblock: "123" });
  });

  it.each([
    [etherscanInvalidKey, "AUTHENTICATION_FAILED"],
    [etherscanPlanRestricted, "PLAN_RESTRICTED"],
    [etherscanRateLimited, "RATE_LIMITED"],
    [etherscanUnsupportedChain, "UNSUPPORTED_CHAIN"],
  ] as const)("classifies logical envelope %s", async (body, code) => {
    const result = await new EtherscanAdapter({ transport: new FixtureTransport(body) })
      .getTransactions(parseTransactionsRequest({ chain: 1, address: "0x1111111111111111111111111111111111111111" }), context())
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ code, provider: "etherscan", chainId: 1 });
  });

  it("classifies a Standard-or-higher endpoint requirement as a plan restriction", async () => {
    const result = await new EtherscanAdapter({
      transport: new FixtureTransport({
        status: "0",
        message: "NOTOK",
        result: "This endpoint is only available to Standard plan subscribers.",
      }),
    })
      .getTransactions(parseTransactionsRequest({ chain: 1, address: "0x1111111111111111111111111111111111111111" }), context())
      .catch((error: unknown) => error);

    expect(result).toMatchObject({ code: "PLAN_RESTRICTED", provider: "etherscan", chainId: 1 });
  });

  it("classifies an otherwise-unspecified holdings rejection as a plan restriction", async () => {
    const result = await new EtherscanAdapter({
      transport: new FixtureTransport({ status: "0", message: "NOTOK", result: "Endpoint is unavailable." }),
    })
      .getErc20TokenHoldings({ address: "0x1111111111111111111111111111111111111111" }, context())
      .catch((error: unknown) => error);

    expect(result).toMatchObject({ code: "PLAN_RESTRICTED", provider: "etherscan", chainId: 1 });
  });

  it("classifies selected HTTP failures and honors Retry-After", async () => {
    const result = await new EtherscanAdapter({
      transport: new FixtureTransport({ error: true }, 429, { "retry-after": "2" }),
    })
      .getTransactions(parseTransactionsRequest({ chain: 1, address: "0x1111111111111111111111111111111111111111" }), context())
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "RATE_LIMITED", retryAfterMs: 2_000 });
  });

  it("classifies HTTP parameter rejection as invalid request", async () => {
    const result = await new EtherscanAdapter({ transport: new FixtureTransport({ error: "invalid address" }, 400) })
      .getTransactions(parseTransactionsRequest({ chain: 1, address: "0x1111111111111111111111111111111111111111" }), context())
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "INVALID_REQUEST", provider: "etherscan" });
  });

  it("normalizes transport failures without exposing authenticated request details", async () => {
    const transport: HttpTransport = {
      async request() {
        throw new Error("https://api.etherscan.io/v2/api?apikey=secret-key");
      },
    };
    const result = await new EtherscanAdapter({ transport })
      .getTransactions(parseTransactionsRequest({ chain: 1, address: "0x1111111111111111111111111111111111111111" }), context())
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "PROVIDER_UNAVAILABLE", provider: "etherscan" });
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });

  it("rejects malformed successful payloads without leaking credentials", async () => {
    const result = await new EtherscanAdapter({ transport: new FixtureTransport({ status: "1", message: "OK", result: [{ nope: true, apikey: "secret-key" }] }) })
      .getTransactions(parseTransactionsRequest({ chain: 1, address: "0x1111111111111111111111111111111111111111" }), context())
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });
});
