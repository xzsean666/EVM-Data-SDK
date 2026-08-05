import { describe, expect, it } from "vitest";

import { ChainRegistry } from "../../src/chains/ChainRegistry";
import { parseErc20TransfersRequest, parseNativeBalanceRequest, parseTransactionsRequest } from "../../src/domain/operations";
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
  it("supports balance and directional transfers but not transactions or both directions", () => {
    const adapter = new AlchemyAdapter({ transport: new FixtureTransport(alchemyBalanceSuccess) });
    const chain = new ChainRegistry().resolve("ethereum");
    expect(adapter.supports({ operation: "getNativeBalance", chain, request: parseNativeBalanceRequest({ chain: 1, address }), continuation: false })).toBe(true);
    expect(adapter.supports({ operation: "getTransactions", chain, request: parseTransactionsRequest({ chain: 1, address }), continuation: false })).toBe(false);
    expect(adapter.supports({ operation: "getErc20Transfers", chain, request: parseErc20TransfersRequest({ chain: 1, address, direction: "incoming" }), continuation: false })).toBe(true);
    expect(adapter.supports({ operation: "getErc20Transfers", chain, request: parseErc20TransfersRequest({ chain: 1, address, direction: "both" }), continuation: false })).toBe(false);
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
