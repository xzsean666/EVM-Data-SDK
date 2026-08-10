import { describe, expect, it } from "vitest";

import { ChainRegistry } from "../../src/chains/ChainRegistry";
import { parseNativeBalanceRequest, parseTransactionsRequest } from "../../src/domain/operations";
import { EvmDataClient } from "../../src/client/EvmDataClient";
import type { ProviderAttemptContext } from "../../src/providers/DataProviderAdapter";
import { BlockscoutAdapter } from "../../src/providers/blockscout/BlockscoutAdapter";
import type { HttpRequest, HttpResponse, HttpTransport } from "../../src/transport/HttpTransport";

const address = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const blockscoutBody = {
  status: "1",
  message: "OK",
  result: [{
    blockNumber: "00042",
    timeStamp: "1700000000",
    hash: "0xAAA",
    nonce: "0",
    blockHash: "0xBBB",
    transactionIndex: "0",
    from: address,
    to: recipient,
    value: "0010",
    gas: "21000",
    gasUsed: "21000",
    gasPrice: "1",
    input: "0x",
    isError: "0",
    txreceipt_status: "1",
  }],
};

class FixtureTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  private index = 0;

  constructor(private readonly bodies: readonly unknown[]) {}

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const body = this.bodies[Math.min(this.index++, this.bodies.length - 1)];
    return { status: 200, headers: {}, body };
  }
}

function context(overrides: Partial<ProviderAttemptContext> = {}): ProviderAttemptContext {
  return {
    chain: new ChainRegistry().resolve("ethereum"),
    credential: { id: "blockscout-key-1", value: "blockscout-secret" },
    proxy: null,
    timeoutMs: 1_000,
    correlationId: "blockscout-test",
    ...overrides,
  };
}

describe("BlockscoutAdapter", () => {
  it("uses the Etherscan-compatible account contract and a Blockscout provenance", async () => {
    const transport = new FixtureTransport([blockscoutBody]);
    const adapter = new BlockscoutAdapter({
      transport,
      baseUrl: "https://blockscout.example/api",
    });
    const request = parseTransactionsRequest({ chain: 1, address, pageSize: 1, order: "asc" });

    expect(adapter.name).toBe("blockscout");
    expect(adapter.supports({
      operation: request.operation,
      chain: new ChainRegistry().resolve("ethereum"),
      request,
      continuation: false,
    })).toBe(true);
    expect(adapter.supports({
      operation: request.operation,
      chain: new ChainRegistry().resolve("base"),
      request: parseTransactionsRequest({ chain: "base", address, pageSize: 1 }),
      continuation: false,
    })).toBe(true);

    const result = await adapter.getTransactions(request, context());
    expect(result.items).toMatchObject([{ hash: "0xaaa", blockNumber: "42", provider: "blockscout" }]);
    expect(result.pageInfo).toEqual({ provider: "blockscout", chainId: 1 });
    expect(transport.requests[0]).toMatchObject({
      method: "GET",
      url: "https://blockscout.example/api",
      params: {
        module: "account",
        action: "txlist",
        address,
        page: 1,
        offset: 1,
        sort: "asc",
        apikey: "blockscout-secret",
      },
    });
    expect(transport.requests[0]?.params).not.toHaveProperty("chainid");
  });

  it("can be the only configured provider and rotates only its own key pool", async () => {
    const transport = new FixtureTransport([
      { status: "0", message: "NOTOK", result: "Invalid API Key" },
      blockscoutBody,
    ]);
    const client = new EvmDataClient({
      providers: [{ kind: "blockscout", apiKeys: ["key-a", "key-b"], baseUrl: "https://blockscout.example/api" }],
      requestPolicy: { maxTotalAttempts: 2 },
    }, { transport });

    const result = await client.address.getTransactions({ chain: "ethereum", address, pageSize: 1 });
    expect(result.pageInfo.provider).toBe("blockscout");
    expect(transport.requests.map((request) => request.params?.apikey)).toEqual(["key-a", "key-b"]);
  });

  it("falls back from Etherscan to Blockscout while keeping the response shape", async () => {
    const transport = new FixtureTransport([
      { status: "0", message: "NOTOK", result: "Invalid API Key" },
      { status: "1", message: "OK", result: "123" },
    ]);
    const client = new EvmDataClient({
      providers: [
        { kind: "etherscan", apiKeys: ["etherscan-key"] },
        { kind: "blockscout", apiKeys: ["blockscout-key"], baseUrl: "https://blockscout.example/api" },
      ],
      requestPolicy: { maxTotalAttempts: 2 },
    }, { transport });

    const result = await client.address.getNativeBalance({ chain: 1, address });
    expect(result).toMatchObject({ amount: "123", provider: "blockscout", chainId: 1 });
    expect(transport.requests.map((request) => request.params?.apikey)).toEqual([
      "etherscan-key",
      "blockscout-key",
    ]);
  });

  it("keeps full-data mode available with only Blockscout configured", async () => {
    const transport = new FixtureTransport([blockscoutBody]);
    const client = new EvmDataClient({
      providers: [{ kind: "blockscout", apiKeys: ["key"], baseUrl: "https://blockscout.example/api" }],
      requestPolicy: { maxTotalAttempts: 1 },
    }, { transport });

    const result = await client.address.getTransactions({ chain: 1, address, fullData: true });
    expect(result.pageInfo.provider).toBe("blockscout");
    expect(transport.requests[0]?.params).toMatchObject({ action: "txlist", offset: 1_000 });
  });

  it("uses the built-in Ethereum route when no Blockscout baseUrl is supplied", async () => {
    const transport = new FixtureTransport([{ status: "1", message: "OK", result: "7" }]);
    const adapter = new BlockscoutAdapter({ transport });
    await adapter.getNativeBalance(parseNativeBalanceRequest({ chain: 1, address }), context());
    expect(transport.requests[0]?.url).toBe("https://eth.blockscout.com/api");
  });

  it("keeps API-only timestamp lookup on the Blockscout provider", async () => {
    const transport = new FixtureTransport([{ status: "1", message: "OK", result: "12345" }]);
    const client = new EvmDataClient({
      providers: [{ kind: "blockscout", apiKeys: ["key"], baseUrl: "https://blockscout.example/api" }],
    }, { transport });

    await expect(client.chain.getBlockNumberByTimestamp({
      chain: "ethereum",
      timestamp: "1700000000",
    })).resolves.toEqual({ chainId: 1, blockNumber: "12345", provider: "blockscout" });
    expect(transport.requests[0]?.params).toMatchObject({
      module: "block",
      action: "getblocknobytime",
      apikey: "key",
    });
  });

  it("classifies Blockscout logical errors without exposing the API key", async () => {
    const adapter = new BlockscoutAdapter({
      transport: new FixtureTransport([{ status: "0", message: "NOTOK", result: "Invalid API Key" }]),
      baseUrl: "https://blockscout.example/api",
    });
    const error = await adapter.getNativeBalance(
      parseNativeBalanceRequest({ chain: 1, address }),
      context(),
    ).catch((failure: unknown) => failure);

    expect(error).toMatchObject({ code: "AUTHENTICATION_FAILED", provider: "blockscout" });
    expect(String(error)).not.toContain("blockscout-secret");
  });
});
