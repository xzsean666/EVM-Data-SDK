import { describe, expect, it } from "vitest";

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

  it("rejects an unsupported both-direction transfer before transport", async () => {
    const transport = new SequenceTransport([]);
    const client = new EvmDataClient({ providers: [{ kind: "alchemy", apiKeys: ["key"] }] }, { transport });
    const result = await client.token.getErc20Transfers({ chain: "ethereum", address, direction: "both" }).catch((error: unknown) => error);
    expect(result).toMatchObject({ code: "UNSUPPORTED_OPERATION" });
    expect(transport.requests).toHaveLength(0);
  });

  it("passes proxy-only routing to the transport", async () => {
    const transport = new SequenceTransport([{ jsonrpc: "2.0", id: 1, result: "0x1" }]);
    const client = new EvmDataClient({
      providers: [{ kind: "alchemy", apiKeys: ["key"] }],
      requestPolicy: { allowDirect: false, maxTotalAttempts: 1 },
      proxies: [{ url: "http://proxy-user:proxy-pass@example.test:8080" }],
    }, { transport });
    await client.address.getNativeBalance({ chain: 1, address });
    expect(transport.requests[0]?.proxy).toMatchObject({ protocol: "http", host: "example.test", port: 8080, auth: { username: "proxy-user", password: "proxy-pass" } });
  });

  it("honors explicit insecure HTTP opt-in for custom provider gateways", async () => {
    const transport = new SequenceTransport([{ jsonrpc: "2.0", id: 1, result: "0x1" }]);
    const client = new EvmDataClient({
      providers: [{ kind: "alchemy", apiKeys: ["key"], baseUrl: "http://gateway.example/v2", allowInsecureHttp: true }],
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
