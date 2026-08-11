import { describe, expect, it } from "vitest";

import { ChainRegistry } from "../../src/chains/ChainRegistry";
import { HttpTransportError } from "../../src/transport/HttpTransport";
import type { HttpRequest, HttpResponse, HttpTransport } from "../../src/transport/HttpTransport";
import { normalizeErc20BlockRangeRequest, parseErc20TransfersRequest, parseNativeBalanceRequest, parseTransactionsRequest } from "../../src/domain/operations";
import type { ProviderAttemptContext } from "../../src/providers/DataProviderAdapter";
import { MoralisAdapter } from "../../src/providers/moralis/MoralisAdapter";
import {
  moralisBalance,
  moralisErc20Balances,
  moralisRateLimited,
  moralisTokenTransfers,
  moralisTransactionsLastPage,
  moralisTransactionsPage,
  moralisUnsupportedChain,
  moralisValidationFailure,
} from "../fixtures/moralis";

class FixtureTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];

  constructor(
    private readonly body: unknown,
    private readonly status = 200,
    private readonly headers: Record<string, string> = {},
  ) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    return { status: this.status, headers: this.headers, body: this.body };
  }
}

class SequenceTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly bodies: readonly unknown[]) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const body = this.bodies[this.requests.length - 1];
    if (body === undefined) throw new Error("Unexpected fixture request.");
    return { status: 200, headers: {}, body };
  }
}

function context(overrides: Partial<ProviderAttemptContext> = {}): ProviderAttemptContext {
  return {
    chain: new ChainRegistry().resolve("ethereum"),
    credential: { id: "moralis-key-1", value: "moralis-key-secret" },
    proxy: null,
    timeoutMs: 1_000,
    correlationId: "test",
    ...overrides,
  };
}

describe("MoralisAdapter", () => {
  it("does not advertise list pages above 100 records", () => {
    const adapter = new MoralisAdapter({ transport: new FixtureTransport(moralisTransactionsPage) });
    const chain = new ChainRegistry().resolve("ethereum");
    expect(adapter.supports({ operation: "getTransactions", chain, request: parseTransactionsRequest({ chain: 1, address: "0x1111111111111111111111111111111111111111", pageSize: 100 }), continuation: false })).toBe(true);
    expect(adapter.supports({ operation: "getTransactions", chain, request: parseTransactionsRequest({ chain: 1, address: "0x1111111111111111111111111111111111111111", pageSize: 101 }), continuation: false })).toBe(false);
  });

  it("maps raw transactions and preserves chain, block, order, and page filters", async () => {
    const transport = new FixtureTransport(moralisTransactionsPage);
    const adapter = new MoralisAdapter({ transport });
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
      transactionIndex: "1",
      timestamp: "2024-01-02T03:04:05.000Z",
      status: "success",
    });
    expect(result.nextPageState).toEqual({ cursor: "moralis-provider-cursor-page-2" });
    expect(transport.requests[0]).toMatchObject({
      method: "GET",
      url: "https://deep-index.moralis.io/api/v2.2/0x1111111111111111111111111111111111111111",
      headers: { "X-API-Key": "moralis-key-secret" },
      params: { chain: "0x1", limit: 1, order: "ASC", from_block: "1", to_block: "999" },
    });
  });

  it("sends only the provider cursor on continuation and maps terminal contract-creation results", async () => {
    const transport = new FixtureTransport(moralisTransactionsLastPage);
    const request = parseTransactionsRequest({
      chain: 1,
      address: "0x1111111111111111111111111111111111111111",
      pageSize: 2,
    });
    const result = await new MoralisAdapter({ transport }).getTransactions(
      request,
      context({ providerPageState: { cursor: "moralis-provider-cursor-page-2" } }),
    );
    expect(result.items[0]).toMatchObject({ to: null, status: "reverted", timestamp: null, gasLimit: null });
    expect(result.items[1]).toMatchObject({ to: null, status: "unknown", timestamp: null });
    expect(result.nextPageState).toBeNull();
    expect(transport.requests[0]?.params).toMatchObject({ cursor: "moralis-provider-cursor-page-2", limit: 2, order: "DESC" });
  });

  it("maps native balances from raw balance fields and chain metadata", async () => {
    const result = await new MoralisAdapter({ transport: new FixtureTransport(moralisBalance) })
      .getNativeBalance(parseNativeBalanceRequest({ chain: 1, address: "0x1111111111111111111111111111111111111111" }), context());
    expect(result).toMatchObject({ amount: "123", decimals: 18, symbol: "ETH", blockNumber: null, provider: "moralis" });
  });

  it("maps current holdings and projects a complete historical REST inventory onto explicit contracts", async () => {
    const token = "0x5555555555555555555555555555555555555555";
    const missing = "0x6666666666666666666666666666666666666666";
    const holdingsTransport = new FixtureTransport(moralisErc20Balances);
    const holdings = await new MoralisAdapter({ transport: holdingsTransport })
      .getErc20TokenHoldings({ address: "0x1111111111111111111111111111111111111111", blockNumber: "20000000" }, context());
    expect(holdings).toMatchObject({
      provider: "moralis",
      pages: 1,
      upstreamRequests: 1,
      items: [{ tokenAddress: token, amount: "123456", tokenDecimals: 6, tokenSymbol: "FIX" }],
    });
    expect(holdingsTransport.requests[0]?.params).toEqual({ chain: "0x1", to_block: "20000000" });

    const snapshotTransport = new FixtureTransport(moralisErc20Balances);
    const balances = await new MoralisAdapter({ transport: snapshotTransport }).getErc20BalancesAtBlock({
      address: "0x1111111111111111111111111111111111111111",
      blockNumber: "20000000",
      tokenAddresses: [token, missing],
    }, context());
    expect(balances).toMatchObject({
      provider: "moralis",
      blockNumber: "20000000",
      items: [
        { tokenAddress: token, amount: "123456" },
        { tokenAddress: missing, amount: "0" },
      ],
    });
    expect(snapshotTransport.requests[0]?.params).toEqual({ chain: "0x1", to_block: "20000000" });
  });

  it("does not issue a malformed current-holdings request without the required indexed block", async () => {
    const transport = new FixtureTransport(moralisErc20Balances);
    const result = await new MoralisAdapter({ transport })
      .getErc20TokenHoldings({ address: "0x1111111111111111111111111111111111111111" }, context())
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "INVALID_REQUEST", provider: "moralis", chainId: 1 });
    expect(transport.requests).toHaveLength(0);
  });

  it("rejects a duplicate balance contract instead of silently choosing one amount", async () => {
    const result = await new MoralisAdapter({
      transport: new FixtureTransport([...moralisErc20Balances, { ...moralisErc20Balances[0], balance: "1" }]),
    }).getErc20BalancesAtBlock({
      address: "0x1111111111111111111111111111111111111111",
      blockNumber: "20000000",
      tokenAddresses: ["0x5555555555555555555555555555555555555555"],
    }, context()).catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "INVALID_PROVIDER_RESPONSE", provider: "moralis", chainId: 1 });
  });

  it("filters ERC-20 transfers by direction after mapping and retains provider pagination", async () => {
    const transport = new FixtureTransport(moralisTokenTransfers);
    const request = parseErc20TransfersRequest({
      chain: 1,
      address: "0x4444444444444444444444444444444444444444",
      tokenAddress: "0x5555555555555555555555555555555555555555",
      direction: "incoming",
      pageSize: 2,
    });
    const result = await new MoralisAdapter({ transport }).getErc20Transfers(request, context());
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ amount: "99", tokenDecimals: 18, logIndex: "3" });
    expect(result.nextPageState).toEqual({ cursor: "moralis-token-cursor-page-2" });
    expect(transport.requests[0]?.params).toMatchObject({
      chain: "0x1",
      limit: 2,
      order: "DESC",
      contract_addresses: "0x5555555555555555555555555555555555555555",
    });
  });

  it("uses a fresh ascending closed range request and only accepts an absent cursor as terminal", async () => {
    const terminalTransport = new FixtureTransport({ ...moralisTokenTransfers, cursor: null });
    const request = normalizeErc20BlockRangeRequest({
      chain: 1,
      address: "0x4444444444444444444444444444444444444444",
      startBlock: "40",
      endBlock: "43",
      direction: "incoming",
    });
    const terminal = await new MoralisAdapter({ transport: terminalTransport }).getErc20TransfersByBlockRangeWindow(request, context());
    expect(terminal.complete).toBe(true);
    expect(terminalTransport.requests[0]?.params).toMatchObject({ chain: "0x1", limit: 100, order: "ASC", from_block: "40", to_block: "43" });

    const continuationTransport = new SequenceTransport([
      moralisTokenTransfers,
      { ...moralisTokenTransfers, cursor: null },
    ]);
    const complete = await new MoralisAdapter({ transport: continuationTransport }).getErc20TransfersByBlockRangeWindow(request, context());
    expect(complete.complete).toBe(true);
    expect(continuationTransport.requests).toHaveLength(2);
    expect(continuationTransport.requests[1]?.params).toMatchObject({ cursor: "moralis-token-cursor-page-2" });
  });

  it.each([
    [401, { message: "Invalid API key" }, "AUTHENTICATION_FAILED"],
    [403, { message: "Plan limit reached" }, "PLAN_RESTRICTED"],
    [404, moralisUnsupportedChain, "UNSUPPORTED_CHAIN"],
    [404, { message: "Endpoint not found" }, "INVALID_PROVIDER_RESPONSE"],
    [400, moralisValidationFailure, "INVALID_REQUEST"],
    [425, { message: "Too early" }, "PROVIDER_UNAVAILABLE"],
    [429, moralisRateLimited, "RATE_LIMITED"],
    [500, { message: "Server error" }, "PROVIDER_UNAVAILABLE"],
  ] as const)("classifies HTTP %i as %s", async (status, body, code) => {
    const result = await new MoralisAdapter({ transport: new FixtureTransport(body, status) })
      .getTransactions(parseTransactionsRequest({ chain: 1, address: "0x1111111111111111111111111111111111111111" }), context())
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ code, provider: "moralis", chainId: 1 });
  });

  it("honors Retry-After, rejects malformed success bodies, and redacts provider cursors", async () => {
    const rateResult = await new MoralisAdapter({
      transport: new FixtureTransport(moralisRateLimited, 429, { "Retry-After": "2" }),
    })
      .getTransactions(parseTransactionsRequest({ chain: 1, address: "0x1111111111111111111111111111111111111111" }), context())
      .catch((error: unknown) => error);
    expect(rateResult).toMatchObject({ code: "RATE_LIMITED", retryAfterMs: 2_000 });

    const malformed = await new MoralisAdapter({ transport: new FixtureTransport({ result: [{ nope: true, cursor: "provider-cursor-secret" }] }) })
      .getTransactions(parseTransactionsRequest({ chain: 1, address: "0x1111111111111111111111111111111111111111" }), context())
      .catch((error: unknown) => error);
    expect(malformed).toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    expect(JSON.stringify(malformed)).not.toContain("provider-cursor-secret");
  });

  it("normalizes transport failures without retaining API keys or provider cursors", async () => {
    const transport: HttpTransport = {
      async request() {
        throw new HttpTransportError({
          code: "NETWORK_ERROR",
          message: "https://deep-index.moralis.io/api/v2.2/address?cursor=provider-cursor-secret",
          retryable: true,
        });
      },
    };
    const result = await new MoralisAdapter({ transport })
      .getTransactions(parseTransactionsRequest({ chain: 1, address: "0x1111111111111111111111111111111111111111" }), context())
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "NETWORK_ERROR", provider: "moralis" });
    expect(JSON.stringify(result)).not.toContain("moralis-key-secret");
    expect(JSON.stringify(result)).not.toContain("provider-cursor-secret");
  });
});
