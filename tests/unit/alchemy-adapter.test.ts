import { describe, expect, it } from "vitest";

import { ChainRegistry } from "../../src/chains/ChainRegistry";
import { normalizeErc20BlockRangeRequest, parseErc20TransfersRequest, parseNativeBalanceRequest, parseTransactionsRequest } from "../../src/domain/operations";
import type { ProviderAttemptContext } from "../../src/providers/DataProviderAdapter";
import { AlchemyAdapter } from "../../src/providers/alchemy/AlchemyAdapter";
import type { HttpRequest, HttpResponse, HttpTransport } from "../../src/transport/HttpTransport";
import { alchemyBalanceSuccess, alchemyRpcInvalidParams, alchemyRpcRateLimited, alchemyTransfersLastPage, alchemyTransfersPage } from "../fixtures/alchemy";

class FixtureTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  constructor(private readonly body: unknown, private readonly status = 200, private readonly headers: Record<string, string> = {}) {}
  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    return { status: this.status, headers: this.headers, body: this.body };
  }
}

class BothDirectionTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];

  constructor(
    private readonly incomingFirst: unknown,
    private readonly outgoingFirst: unknown,
    private readonly incomingContinuation: unknown,
    private readonly outgoingContinuation: unknown,
  ) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const filter = ((request.body as { params?: readonly unknown[] }).params?.[0] ?? {}) as Record<string, unknown>;
    const incoming = "toAddress" in filter;
    const continuation = "pageKey" in filter;
    const body = incoming
      ? continuation ? this.incomingContinuation : this.incomingFirst
      : continuation ? this.outgoingContinuation : this.outgoingFirst;
    return { status: 200, headers: {}, body };
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

const address = "0x2222222222222222222222222222222222222222";

describe("AlchemyAdapter", () => {
  it("supports balance and ERC-20 transfers in every direction but not transactions", () => {
    const adapter = new AlchemyAdapter({ transport: new FixtureTransport(alchemyBalanceSuccess) });
    const chain = new ChainRegistry().resolve("ethereum");
    expect(adapter.supports({ operation: "getNativeBalance", chain, request: parseNativeBalanceRequest({ chain: 1, address }), continuation: false })).toBe(true);
    expect(adapter.supports({ operation: "getTransactions", chain, request: parseTransactionsRequest({ chain: 1, address }), continuation: false })).toBe(false);
    expect(adapter.supports({ operation: "getErc20Transfers", chain, request: parseErc20TransfersRequest({ chain: 1, address, direction: "incoming" }), continuation: false })).toBe(true);
    expect(adapter.supports({ operation: "getErc20Transfers", chain, request: parseErc20TransfersRequest({ chain: 1, address, direction: "incoming", pageSize: 1_000 }), continuation: false })).toBe(true);
    expect(adapter.supports({ operation: "getErc20Transfers", chain, request: parseErc20TransfersRequest({ chain: 1, address, direction: "incoming", pageSize: 1_001 }), continuation: false })).toBe(false);
    expect(adapter.supports({ operation: "getErc20Transfers", chain, request: parseErc20TransfersRequest({ chain: 1, address, direction: "both", pageSize: 1_000 }), continuation: false })).toBe(true);
    expect(adapter.supports({ operation: "getErc20Transfers", chain, request: parseErc20TransfersRequest({ chain: 1, address, direction: "both", pageSize: 1_001 }), continuation: false })).toBe(false);
  });

  it("maps hexadecimal native balance and uses header authentication", async () => {
    const transport = new FixtureTransport(alchemyBalanceSuccess);
    const result = await new AlchemyAdapter({ transport }).getNativeBalance(parseNativeBalanceRequest({ chain: 1, address }), context());
    expect(result).toMatchObject({ amount: "123456", decimals: 18, symbol: "ETH", provider: "alchemy" });
    expect(transport.requests[0]).toMatchObject({ method: "POST", url: "https://eth-mainnet.g.alchemy.com/v2", headers: { Authorization: "Bearer secret-key" } });
    expect(transport.requests[0]?.body).toMatchObject({ method: "eth_getBalance", params: [address, "latest"] });
    expect(transport.requests[0]?.url).not.toContain("secret-key");
  });

  it("maps directional ERC-20 transfers and preserves page key filters", async () => {
    const transport = new FixtureTransport(alchemyTransfersPage);
    const request = parseErc20TransfersRequest({ chain: 1, address, tokenAddress: "0x5555555555555555555555555555555555555555", direction: "incoming", pageSize: 2, order: "asc", startBlock: "10", endBlock: "42" });
    const result = await new AlchemyAdapter({ transport }).getErc20Transfers(request, context());
    expect(result.items[0]).toMatchObject({ amount: "99", blockNumber: "42", tokenSymbol: "TOK", tokenDecimals: 18, timestamp: "2024-01-02T03:04:05.000Z" });
    expect(result.nextPageState).toEqual({ pageKey: "alchemy-page-key-2" });
    expect(transport.requests[0]?.body).toMatchObject({ method: "alchemy_getAssetTransfers", params: [{ category: ["erc20"], toAddress: address, contractAddresses: ["0x5555555555555555555555555555555555555555"], fromBlock: "0xa", toBlock: "0x2a", maxCount: "0x2", order: "asc" }] });
  });

  it("uses page key continuation and recognizes terminal pages", async () => {
    const transport = new FixtureTransport(alchemyTransfersLastPage);
    const request = parseErc20TransfersRequest({ chain: 1, address, direction: "outgoing" });
    const result = await new AlchemyAdapter({ transport }).getErc20Transfers(request, context({ providerPageState: { pageKey: "page-key-2" } }));
    expect(result.items).toEqual([]);
    expect(result.nextPageState).toBeNull();
    expect(transport.requests[0]?.body).toMatchObject({ params: [{ fromAddress: address, pageKey: "page-key-2" }] });
  });

  it("returns both complete Alchemy pages, de-duplicates a self-transfer, and keeps two stream page keys", async () => {
    const incomingFirst = transfersResponse([
      transfer("incoming", "0xc", "0x1111111111111111111111111111111111111111", address),
      transfer("self", "0xa", address, address),
    ], "incoming-next");
    const outgoingFirst = transfersResponse([
      transfer("outgoing", "0xb", address, "0x3333333333333333333333333333333333333333"),
      transfer("self", "0xa", address, address),
    ], "outgoing-next");
    const incomingContinuation = transfersResponse([
      transfer("incoming-continuation", "0x9", "0x1111111111111111111111111111111111111111", address),
    ], null);
    const outgoingContinuation = transfersResponse([
      transfer("outgoing-continuation", "0x8", address, "0x3333333333333333333333333333333333333333"),
    ], null);
    const transport = new BothDirectionTransport(incomingFirst, outgoingFirst, incomingContinuation, outgoingContinuation);
    const adapter = new AlchemyAdapter({ transport });
    const request = parseErc20TransfersRequest({ chain: 1, address, direction: "both", pageSize: 2, order: "desc" });

    const first = await adapter.getErc20Transfers(request, context());
    expect(first.items.map((item) => item.blockNumber)).toEqual(["12", "11", "10"]);
    expect(first.items).toHaveLength(3);
    expect(first.nextPageState).toEqual({
      mode: "both",
      incomingPageKey: "incoming-next",
      incomingExhausted: false,
      outgoingPageKey: "outgoing-next",
      outgoingExhausted: false,
    });
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[0]?.body).toMatchObject({ params: [{ toAddress: address, maxCount: "0x2" }] });
    expect(transport.requests[1]?.body).toMatchObject({ params: [{ fromAddress: address, maxCount: "0x2" }] });

    const second = await adapter.getErc20Transfers(request, context({ providerPageState: first.nextPageState }));
    expect(second.items.map((item) => item.blockNumber)).toEqual(["9", "8"]);
    expect(second.nextPageState).toBeNull();
    expect(transport.requests[2]?.body).toMatchObject({ params: [{ toAddress: address, pageKey: "incoming-next" }] });
    expect(transport.requests[3]?.body).toMatchObject({ params: [{ fromAddress: address, pageKey: "outgoing-next" }] });
  });

  it("restarts both directions from one inclusive range without carrying page keys", async () => {
    const incoming = transfersResponse([transfer("incoming", "0x2a", "0x1111111111111111111111111111111111111111", address)], null);
    const outgoing = transfersResponse([transfer("outgoing", "0x2a", address, "0x3333333333333333333333333333333333333333")], "must-split");
    const transport = new BothDirectionTransport(incoming, outgoing, incoming, outgoing);
    const result = await new AlchemyAdapter({ transport }).getErc20TransfersByBlockRangeWindow(
      normalizeErc20BlockRangeRequest({ chain: 1, address, startBlock: "40", endBlock: "42", direction: "both" }),
      context({ providerPageState: { pageKey: "ignored-by-range-operation" } }),
    );
    expect(result.complete).toBe(false);
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[0]?.body).toMatchObject({ params: [{ toAddress: address, fromBlock: "0x28", toBlock: "0x2a", maxCount: "0x3e8", order: "asc" }] });
    expect(transport.requests[1]?.body).toMatchObject({ params: [{ fromAddress: address, fromBlock: "0x28", toBlock: "0x2a", maxCount: "0x3e8", order: "asc" }] });
    expect(JSON.stringify(transport.requests)).not.toContain("ignored-by-range-operation");
  });

  it("rejects a single-stream cursor for a both-direction request", async () => {
    const result = await new AlchemyAdapter({ transport: new FixtureTransport(alchemyTransfersLastPage) }).getErc20Transfers(
      parseErc20TransfersRequest({ chain: 1, address, direction: "both" }),
      context({ providerPageState: { pageKey: "single-stream-page" } }),
    ).catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "INVALID_PROVIDER_RESPONSE", provider: "alchemy" });
  });

  it("assigns a self-transfer to the outgoing stream so it cannot repeat across composite pages", async () => {
    const incomingFirst = transfersResponse([
      transfer("incoming", "0xc", "0x1111111111111111111111111111111111111111", address),
      transfer("self", "0xa", address, address),
    ], null);
    const outgoingFirst = transfersResponse([
      transfer("outgoing", "0xb", address, "0x3333333333333333333333333333333333333333"),
    ], "outgoing-next");
    const outgoingContinuation = transfersResponse([
      transfer("self", "0xa", address, address),
    ], null);
    const transport = new BothDirectionTransport(incomingFirst, outgoingFirst, transfersResponse([], null), outgoingContinuation);
    const adapter = new AlchemyAdapter({ transport });
    const request = parseErc20TransfersRequest({ chain: 1, address, direction: "both", pageSize: 2, order: "desc" });

    const first = await adapter.getErc20Transfers(request, context());
    expect(first.items.map((item) => item.blockNumber)).toEqual(["12", "11"]);
    expect(first.nextPageState).toEqual({
      mode: "both",
      incomingPageKey: null,
      incomingExhausted: true,
      outgoingPageKey: "outgoing-next",
      outgoingExhausted: false,
    });

    const second = await adapter.getErc20Transfers(request, context({ providerPageState: first.nextPageState }));
    expect(second.items.map((item) => item.blockNumber)).toEqual(["10"]);
    expect(second.nextPageState).toBeNull();
    expect(transport.requests).toHaveLength(3);
    expect(transport.requests[2]?.body).toMatchObject({ params: [{ fromAddress: address, pageKey: "outgoing-next" }] });
  });

  it("treats Alchemy's blank terminal page key as no continuation", async () => {
    const result = await new AlchemyAdapter({
      transport: new FixtureTransport({ jsonrpc: "2.0", id: 1, result: { transfers: [], pageKey: "" } }),
    }).getErc20Transfers(
      parseErc20TransfersRequest({ chain: 1, address, direction: "incoming" }),
      context(),
    );
    expect(result.nextPageState).toBeNull();
  });

  it("rejects a repeated provider page key instead of allowing an infinite continuation", async () => {
    const result = await new AlchemyAdapter({
      transport: new FixtureTransport({ jsonrpc: "2.0", id: 1, result: { transfers: [], pageKey: "page-key-2" } }),
    }).getErc20Transfers(
      parseErc20TransfersRequest({ chain: 1, address, direction: "incoming" }),
      context({ providerPageState: { pageKey: "page-key-2" } }),
    ).catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });

  it.each([[alchemyRpcRateLimited, "RATE_LIMITED"], [alchemyRpcInvalidParams, "INVALID_REQUEST"]] as const)("classifies JSON-RPC error %s", async (body, code) => {
    const result = await new AlchemyAdapter({ transport: new FixtureTransport(body) }).getNativeBalance(parseNativeBalanceRequest({ chain: 1, address }), context()).catch((error: unknown) => error);
    expect(result).toMatchObject({ code, provider: "alchemy", chainId: 1 });
  });

  it("classifies HTTP throttling and redacts failures", async () => {
    const result = await new AlchemyAdapter({ transport: new FixtureTransport({ error: true }, 429, { "retry-after": "2" }) }).getNativeBalance(parseNativeBalanceRequest({ chain: 1, address }), context()).catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "RATE_LIMITED", retryAfterMs: 2_000 });
    expect(JSON.stringify(result)).not.toContain("secret-key");
  });

  it("classifies HTTP parameter rejection as invalid request", async () => {
    const result = await new AlchemyAdapter({ transport: new FixtureTransport({ error: "invalid params" }, 400) })
      .getNativeBalance(parseNativeBalanceRequest({ chain: 1, address }), context())
      .catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "INVALID_REQUEST", provider: "alchemy" });
  });

  it("normalizes malformed provider payloads", async () => {
    const result = await new AlchemyAdapter({ transport: new FixtureTransport({ jsonrpc: "2.0", id: 1, result: "0xnope" }) }).getNativeBalance(parseNativeBalanceRequest({ chain: 1, address }), context()).catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
  });
});

function transfer(uniqueId: string, blockNum: string, from: string, to: string): Record<string, unknown> {
  return {
    category: "erc20",
    uniqueId,
    asset: "TOK",
    from,
    to,
    hash: `0x${"1".repeat(64)}`,
    blockNum,
    rawContract: { address: "0x5555555555555555555555555555555555555555", decimals: 18, value: "0x1" },
  };
}

function transfersResponse(transfers: readonly Record<string, unknown>[], pageKey: string | null): unknown {
  return { jsonrpc: "2.0", id: 1, result: { transfers, pageKey } };
}
