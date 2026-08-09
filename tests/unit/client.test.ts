import { describe, expect, it, vi } from "vitest";

import { EvmDataClient } from "../../src/client/EvmDataClient";
import { EvmDataError } from "../../src/domain/errors";
import type { DataProviderAdapter } from "../../src/providers/DataProviderAdapter";
import type { HttpRequest, HttpResponse, HttpTransport } from "../../src/transport/HttpTransport";

const address = "0x1111111111111111111111111111111111111111";

class SequenceTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  private index = 0;

  constructor(private readonly bodies: readonly unknown[]) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const body = this.bodies[Math.min(this.index++, this.bodies.length - 1)];
    return { status: 200, headers: {}, body };
  }
}

describe("EvmDataClient", () => {
  it("composes services and keeps Etherscan pagination pinned", async () => {
    const transport = new SequenceTransport([
      { status: "1", message: "OK", result: [{
        blockNumber: "10", timeStamp: "1700000000", hash: "0xaaa", nonce: "0", blockHash: "0xbbb", transactionIndex: "0", from: address, to: "0x2222222222222222222222222222222222222222", value: "1", gas: "21000", gasPrice: "1", gasUsed: "21000", input: "0x", isError: "0", txreceipt_status: "1",
      }] },
      { status: "1", message: "OK", result: [] },
    ]);
    const client = new EvmDataClient({ providers: [{ kind: "etherscan", apiKeys: ["key"] }], requestPolicy: { maxTotalAttempts: 1 } }, { transport });
    const first = await client.address.getTransactions({ chain: 1, address, pageSize: 1 });
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await client.address.getTransactions({ chain: 1, address, pageSize: 1, cursor: first.nextCursor! });
    expect(second.items).toEqual([]);
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[1]?.params).toMatchObject({ page: 2, offset: 1 });
  });

  it("rejects an Etherscan cursor when full-data mode changes", async () => {
    const transport = new SequenceTransport([{
      status: "1", message: "OK", result: [{
        blockNumber: "10", timeStamp: "1700000000", hash: "0xaaa", nonce: "0", blockHash: "0xbbb", transactionIndex: "0", from: address, to: "0x2222222222222222222222222222222222222222", value: "1", gas: "21000", gasPrice: "1", gasUsed: "21000", input: "0x", isError: "0", txreceipt_status: "1",
      }],
    }]);
    const client = new EvmDataClient({ providers: [{ kind: "etherscan", apiKeys: ["key"] }], requestPolicy: { maxTotalAttempts: 1 } }, { transport });
    const first = await client.address.getTransactions({ chain: 1, address, pageSize: 1 });
    const result = await client.address.getTransactions({ chain: 1, address, pageSize: 1, fullData: true, cursor: first.nextCursor! }).catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "INVALID_CURSOR" });
    expect(transport.requests).toHaveLength(1);
  });

  it("sends full-data requests only to Etherscan when other list providers are configured", async () => {
    const transport = new SequenceTransport([{
      status: "1", message: "OK", result: [],
    }]);
    const client = new EvmDataClient({
      providers: [
        { kind: "moralis", apiKeys: ["moralis-key"] },
        { kind: "etherscan", apiKeys: ["etherscan-key"] },
      ],
      requestPolicy: { maxTotalAttempts: 1 },
    }, { transport });
    await client.address.getTransactions({ chain: 1, address, fullData: true });
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.url).toBe("https://api.etherscan.io/v2/api");
    expect(transport.requests[0]?.params).toMatchObject({ offset: 1_000, apikey: "etherscan-key" });
  });

  it("completes a transaction block range without exposing its provider cursor", async () => {
    const transport = new SequenceTransport([{
      status: "1", message: "OK", result: [{
        blockNumber: "10", timeStamp: "1700000000", hash: "0xaaa", nonce: "0", blockHash: "0xbbb", transactionIndex: "0", from: address, to: "0x2222222222222222222222222222222222222222", value: "1", gas: "21000", gasPrice: "1", gasUsed: "21000", input: "0x", isError: "0", txreceipt_status: "1",
      }],
    }]);
    const client = new EvmDataClient({ providers: [{ kind: "etherscan", apiKeys: ["key"] }], requestPolicy: { maxTotalAttempts: 1 } }, { transport });
    const result = await client.address.getTransactionsByBlockRange({ chain: 1, address, startBlock: "1", endBlock: "10" });
    expect(result).toMatchObject({ address, range: { startBlock: "1", endBlock: "10" }, provider: "etherscan", pages: 1, upstreamRequests: 1 });
    expect(transport.requests[0]?.params).toMatchObject({ action: "txlist", startblock: "1", endblock: "10", offset: 1_000 });
    expect(result).not.toHaveProperty("nextCursor");
  });

  it("emits a complete transaction window without retaining it in callback mode", async () => {
    const transport = new SequenceTransport([{
      status: "1", message: "OK", result: [{
        blockNumber: "10", timeStamp: "1700000000", hash: "0xaaa", nonce: "0", blockHash: "0xbbb", transactionIndex: "0", from: address, to: "0x2222222222222222222222222222222222222222", value: "1", gas: "21000", gasPrice: "1", gasUsed: "21000", input: "0x", isError: "0", txreceipt_status: "1",
      }],
    }]);
    const client = new EvmDataClient({ providers: [{ kind: "etherscan", apiKeys: ["key"] }], requestPolicy: { maxTotalAttempts: 1 } }, { transport });
    const windows: number[] = [];

    const result = await client.address.getTransactionsByBlockRange({
      chain: 1,
      address,
      startBlock: "1",
      endBlock: "10",
      onWindow: (window) => { windows.push(window.items.length); },
    });

    expect(windows).toEqual([1]);
    expect(result.items).toEqual([]);
    expect(result.pages).toBe(1);
  });

  it("maps latest height through the explorer API instead of an RPC endpoint", async () => {
    const transport = new SequenceTransport([{ status: "1", message: "OK", result: "12345" }]);
    const client = new EvmDataClient({ providers: [{ kind: "etherscan", apiKeys: ["key"] }] }, { transport });
    const result = await client.chain.getLatestBlockNumber({ chain: "ethereum", now: new Date("2026-08-06T00:00:00.000Z") });
    expect(result).toEqual({ chainId: 1, blockNumber: "12345", provider: "etherscan" });
    expect(transport.requests[0]?.params).toMatchObject({ module: "block", action: "getblocknobytime", closest: "before" });
    expect(transport.requests[0]?.params).not.toHaveProperty("tag");
  });

  it("reads explicit ERC-20 historical balances through Etherscan without RPC", async () => {
    const firstToken = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const secondToken = "0x3333333333333333333333333333333333333333";
    const transport = new SequenceTransport([
      { status: "1", message: "OK", result: "1000000" },
      { status: "1", message: "OK", result: "0" },
    ]);
    const client = new EvmDataClient({
      providers: [{ kind: "etherscan", apiKeys: ["key"] }],
      requestPolicy: { maxTotalAttempts: 1 },
    }, { transport });

    const result = await client.token.getErc20BalancesAtBlock({
      chain: "ethereum",
      address,
      blockNumber: "000123",
      tokenAddresses: [firstToken, secondToken, `0x${firstToken.slice(2).toUpperCase()}`],
    });

    expect(result).toMatchObject({
      chainId: 1,
      address,
      blockNumber: "123",
      provider: "etherscan",
      items: [
        { tokenAddress: firstToken, blockNumber: "123", amount: "1000000" },
        { tokenAddress: secondToken, blockNumber: "123", amount: "0" },
      ],
    });
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[0]?.params).toMatchObject({
      module: "account",
      action: "tokenbalancehistory",
      address,
      contractaddress: firstToken,
      blockno: "123",
    });
    expect(transport.requests[0]?.url).toBe("https://api.etherscan.io/v2/api");
  });

  it("lists current ERC-20 holdings only to discover the historic contract set", async () => {
    const token = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const transport = new SequenceTransport([{
      status: "1",
      message: "OK",
      result: [{
        TokenAddress: token,
        TokenName: "Fixture Token",
        TokenSymbol: "FIX",
        TokenQuantity: "123456",
        TokenDivisor: "6",
      }],
    }]);
    const client = new EvmDataClient({
      providers: [{ kind: "etherscan", apiKeys: ["key"] }],
      requestPolicy: { maxTotalAttempts: 1 },
    }, { transport });

    const result = await client.token.getErc20TokenHoldings({ chain: "ethereum", address });

    expect(result).toMatchObject({
      chainId: 1,
      address,
      provider: "etherscan",
      items: [{ tokenAddress: token, tokenSymbol: "FIX", tokenDecimals: 6, amount: "123456" }],
    });
    expect(transport.requests[0]?.params).toMatchObject({
      module: "account",
      action: "addresstokenbalance",
      address,
      page: 1,
      offset: 100,
    });
  });

  it("tries a later configured Etherscan key after a plan restriction", async () => {
    const transport = new SequenceTransport([
      { status: "0", message: "NOTOK", result: "This endpoint is only available to Standard plan subscribers." },
      {
        status: "1",
        message: "OK",
        result: [{
          TokenAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          TokenName: "Fixture Token",
          TokenSymbol: "FIX",
          TokenQuantity: "123456",
          TokenDivisor: "6",
        }],
      },
    ]);
    const client = new EvmDataClient({
      providers: [{ kind: "etherscan", apiKeys: ["restricted-key", "standard-key"] }],
    }, { transport });

    await expect(client.token.getErc20TokenHoldings({ chain: "ethereum", address })).resolves.toMatchObject({
      items: [{ tokenSymbol: "FIX" }],
    });
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests.map((request) => request.params?.apikey)).toEqual(["restricted-key", "standard-key"]);
  });

  it("falls back from Standard+ Etherscan history to the Moralis REST snapshot without using JSON-RPC", async () => {
    const token = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const missing = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const transport = new SequenceTransport([
      { status: "0", message: "NOTOK", result: "This endpoint is only available to Standard plan subscribers." },
      [{ token_address: token, balance: "42", decimals: 18, name: "Fixture", symbol: "FIX" }],
    ]);
    const client = new EvmDataClient({
      providers: [
        { kind: "etherscan", apiKeys: ["restricted-key"] },
        { kind: "moralis", apiKeys: ["moralis-key"] },
      ],
      requestPolicy: { maxTotalAttempts: 1 },
    }, { transport });

    await expect(client.token.getErc20BalancesAtBlock({
      chain: "ethereum",
      address,
      blockNumber: "20000000",
      tokenAddresses: [token, missing],
    })).resolves.toMatchObject({
      provider: "moralis",
      items: [
        { tokenAddress: token, amount: "42" },
        { tokenAddress: missing, amount: "0" },
      ],
    });
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[0]?.params).toMatchObject({ action: "tokenbalancehistory", blockno: "20000000" });
    expect(transport.requests[1]).toMatchObject({
      method: "GET",
      url: `https://deep-index.moralis.io/api/v2.2/${address}/erc20`,
      params: { chain: "0x1", to_block: "20000000" },
    });
  });

  it("falls back to a Moralis current-holdings snapshot at an indexed API head", async () => {
    const token = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const transport = new SequenceTransport([
      { status: "0", message: "NOTOK", result: "This endpoint is only available to Standard plan subscribers." },
      { status: "1", message: "OK", result: "20000000" },
      [{ token_address: token, balance: "42", decimals: 18, name: "Fixture", symbol: "FIX" }],
    ]);
    const client = new EvmDataClient({
      providers: [
        { kind: "etherscan", apiKeys: ["restricted-key"] },
        { kind: "moralis", apiKeys: ["moralis-key"] },
      ],
      requestPolicy: { maxTotalAttempts: 1 },
    }, { transport });

    await expect(client.token.getErc20TokenHoldings({ chain: "ethereum", address })).resolves.toMatchObject({
      provider: "moralis",
      items: [{ tokenAddress: token, amount: "42" }],
    });
    expect(transport.requests).toHaveLength(3);
    expect(transport.requests[1]?.params).toMatchObject({ action: "getblocknobytime" });
    expect(transport.requests[2]).toMatchObject({
      method: "GET",
      url: `https://deep-index.moralis.io/api/v2.2/${address}/erc20`,
      params: { chain: "0x1", to_block: "20000000" },
    });
  });

  it("routes API-chain endpoints through the configured managed VLESS proxy", async () => {
    const transport = new SequenceTransport([{ status: "1", message: "OK", result: "12345" }]);
    const advancedProxyManager = {
      assertReady: vi.fn(),
      acquire: vi.fn().mockResolvedValue({ id: "sing-box-loopback", url: "http://127.0.0.1:3128" }),
      report: vi.fn(),
      initialize: vi.fn(),
      close: vi.fn(),
    };
    const client = new EvmDataClient({
      providers: [{ kind: "etherscan", apiKeys: ["key"] }],
      requestPolicy: { allowDirect: false, maxTotalAttempts: 1 },
      advancedProxy: {
        kind: "sing-box",
        urls: ["vless://11111111-1111-4111-8111-111111111111@proxy.example:443?security=tls&type=tcp&sni=proxy.example"],
      },
    }, { transport, advancedProxyManager: advancedProxyManager as never });

    await client.chain.getLatestBlockNumber({
      chain: "ethereum",
      now: new Date("2026-08-06T00:00:00.000Z"),
    });

    expect(advancedProxyManager.assertReady).toHaveBeenCalledTimes(1);
    expect(advancedProxyManager.acquire).toHaveBeenCalledTimes(1);
    expect(transport.requests[0]?.proxy).toMatchObject({
      protocol: "http",
      host: "127.0.0.1",
      port: 3128,
    });
  });

  it("executes a both-direction transfer through Alchemy's two provider streams", async () => {
    const transport = new SequenceTransport([{ jsonrpc: "2.0", id: 1, result: { transfers: [], pageKey: null } }]);
    const client = new EvmDataClient({ providers: [{ kind: "alchemy", apiKeys: ["key"] }] }, { transport });
    await expect(client.token.getErc20Transfers({ chain: "ethereum", address, direction: "both" })).resolves.toMatchObject({ items: [] });
    expect(transport.requests).toHaveLength(2);
  });

  it("rejects an Alchemy both-direction cursor before an Etherscan request", async () => {
    const alchemyTransport = new SequenceTransport([{ jsonrpc: "2.0", id: 1, result: { transfers: [], pageKey: "alchemy-next" } }]);
    const alchemy = new EvmDataClient({ providers: [{ kind: "alchemy", apiKeys: ["alchemy-key"] }] }, { transport: alchemyTransport });
    const first = await alchemy.token.getErc20Transfers({ chain: "ethereum", address, direction: "both" });
    const etherscanTransport = new SequenceTransport([]);
    const etherscan = new EvmDataClient({ providers: [{ kind: "etherscan", apiKeys: ["etherscan-key"] }] }, { transport: etherscanTransport });
    const result = await etherscan.token.getErc20Transfers({ chain: "ethereum", address, direction: "both", cursor: first.nextCursor! }).catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "INVALID_CURSOR" });
    expect(etherscanTransport.requests).toHaveLength(0);
  });

  it("rejects a high page request before transport when Etherscan is not configured", async () => {
    const transport = new SequenceTransport([]);
    const client = new EvmDataClient({ providers: [{ kind: "moralis", apiKeys: ["key"] }] }, { transport });
    const result = await client.address.getTransactions({ chain: "ethereum", address, pageSize: 1_001 }).catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "UNSUPPORTED_OPERATION" });
    expect(transport.requests).toHaveLength(0);
  });

  it("forces full-data list requests to Etherscan before transport", async () => {
    const transport = new SequenceTransport([]);
    const client = new EvmDataClient({ providers: [{ kind: "moralis", apiKeys: ["key"] }] }, { transport });
    const result = await client.token.getErc20Transfers({ chain: "ethereum", address, fullData: true }).catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "UNSUPPORTED_OPERATION" });
    expect(transport.requests).toHaveLength(0);
  });

  it("passes proxy-only routing to the transport", async () => {
    const transport = new SequenceTransport([{ status: "1", message: "OK", result: "1" }]);
    const client = new EvmDataClient({
      providers: [{ kind: "etherscan", apiKeys: ["key"] }],
      requestPolicy: { allowDirect: false, maxTotalAttempts: 1 },
      proxies: [{ url: "http://proxy-user:proxy-pass@example.test:8080" }],
    }, { transport });
    await client.address.getNativeBalance({ chain: 1, address });
    expect(transport.requests[0]?.proxy).toMatchObject({ protocol: "http", host: "example.test", port: 8080, auth: { username: "proxy-user", password: "proxy-pass" } });
  });

  it("honors explicit insecure HTTP opt-in for custom provider gateways", async () => {
    const transport = new SequenceTransport([{ status: "1", message: "OK", result: "1" }]);
    const client = new EvmDataClient({
      providers: [{ kind: "etherscan", apiKeys: ["key"], baseUrl: "http://gateway.example/v2", allowInsecureHttp: true }],
      requestPolicy: { maxTotalAttempts: 1 },
    }, { transport });
    await client.address.getNativeBalance({ chain: 1, address });
    expect(transport.requests[0]?.url).toBe("http://gateway.example/v2");
  });

  it("normalizes adapter endpoint construction failures as invalid configuration", () => {
    expect(() => new EvmDataClient({
      providers: [{ kind: "etherscan", apiKeys: ["key"], baseUrl: "https://api.etherscan.io/wrong" }],
    })).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
  });

  it("falls back between providers through the public client composition", async () => {
    const failing: DataProviderAdapter = {
      name: "etherscan",
      supports: ({ operation }) => operation === "getNativeBalance",
      getNativeBalance: async () => {
        throw new EvmDataError({ code: "RATE_LIMITED", message: "limited", retryable: true, provider: "etherscan", chainId: 1 });
      },
    };
    const succeeding: DataProviderAdapter = {
      name: "moralis",
      supports: ({ operation }) => operation === "getNativeBalance",
      getNativeBalance: async (request, context) => ({
        chainId: context.chain.chainId,
        address: request.address,
        amount: "1",
        decimals: 18,
        symbol: "ETH",
        blockNumber: null,
        provider: "moralis",
      }),
    };
    const client = new EvmDataClient({
      providers: [
        { kind: "etherscan", apiKeys: ["key-1"] },
        { kind: "moralis", apiKeys: ["key-2"] },
      ],
      requestPolicy: { maxTotalAttempts: 2 },
    }, { adapters: { etherscan: failing, moralis: succeeding } });
    await expect(client.address.getNativeBalance({ chain: 1, address })).resolves.toMatchObject({ provider: "moralis", amount: "1" });
  });
});

describe("EvmDataClient chainlink/Archive RPC composition (v0.4)", () => {
  it("exposes rpc and chainlink as null when chainlink is not enabled", () => {
    const transport = new SequenceTransport([]);
    const client = new EvmDataClient({ providers: [{ kind: "etherscan", apiKeys: ["key"] }] }, { transport });

    expect(client.rpc).toBeNull();
    expect(client.chainlink).toBeNull();
  });

  it("exposes non-null rpc and chainlink services when chainlink is enabled, without any provider configured", () => {
    const transport = new SequenceTransport([]);
    const client = new EvmDataClient({ chainlink: { enabled: true } }, { transport });

    expect(client.rpc).not.toBeNull();
    expect(client.chainlink).not.toBeNull();
  });

  it("never makes a network call while constructing a chainlink-enabled client", () => {
    const transport = new SequenceTransport([]);
    new EvmDataClient({ chainlink: { enabled: true } }, { transport });

    expect(transport.requests).toHaveLength(0);
  });

  it("initializes the managed proxy and the Archive RPC pool concurrently", async () => {
    const advancedProxyManager = {
      assertReady: vi.fn(),
      acquire: vi.fn(),
      report: vi.fn(),
      initialize: vi.fn().mockResolvedValue(undefined),
      close: vi.fn(),
    };
    const archiveRpcPool = {
      initialize: vi.fn().mockResolvedValue(undefined),
      healthySnapshot: vi.fn().mockReturnValue([]),
      reportOutcome: vi.fn(),
      isHealthy: vi.fn().mockReturnValue(false),
    };
    const client = new EvmDataClient({
      providers: [{ kind: "etherscan", apiKeys: ["key"] }],
      advancedProxy: {
        kind: "sing-box",
        urls: ["vless://11111111-1111-4111-8111-111111111111@proxy.example:443?security=tls&type=tcp&sni=proxy.example"],
      },
      chainlink: { enabled: true },
    }, {
      advancedProxyManager: advancedProxyManager as never,
      archiveRpcPool: archiveRpcPool as never,
    });

    await client.initialize();

    expect(advancedProxyManager.initialize).toHaveBeenCalledTimes(1);
    expect(archiveRpcPool.initialize).toHaveBeenCalledTimes(1);
  });

  it("does not initialize an Archive RPC pool when chainlink is disabled, even if one is injected", async () => {
    const archiveRpcPool = {
      initialize: vi.fn().mockResolvedValue(undefined),
      healthySnapshot: vi.fn().mockReturnValue([]),
      reportOutcome: vi.fn(),
      isHealthy: vi.fn().mockReturnValue(false),
    };
    const client = new EvmDataClient({
      providers: [{ kind: "etherscan", apiKeys: ["key"] }],
    }, { archiveRpcPool: archiveRpcPool as never });

    await client.initialize();

    expect(archiveRpcPool.initialize).not.toHaveBeenCalled();
  });
});

describe("EvmDataClient DeFi composition (v0.5)", () => {
  it("exposes DeFi without an indexed provider and initializes its selected chain pool", async () => {
    const basePool = {
      initialize: vi.fn().mockResolvedValue(undefined),
      healthySnapshot: vi.fn().mockReturnValue([]),
      reportOutcome: vi.fn(),
      isHealthy: vi.fn().mockReturnValue(false),
    };
    const client = new EvmDataClient({ defi: { enabled: true, chains: ["base"] } }, {
      defiArchiveRpcPools: { base: basePool as never },
    });
    expect(client.defi).not.toBeNull();
    expect(client.chainlink).toBeNull();
    await client.initialize();
    expect(basePool.initialize).toHaveBeenCalledTimes(1);
  });

  it("requires an explicit endpoint when built-in DeFi RPCs are disabled", () => {
    expect(() => new EvmDataClient({ defi: { enabled: true, chains: ["base"], useBuiltinArchiveRpcs: false } })).toThrow(/no Archive RPC endpoint/i);
  });
});
