import { describe, expect, it } from "vitest";

import { EvmDataError } from "../../src/domain/errors";
import {
  DEFAULT_ATTEMPT_TIMEOUT_MS,
  DEFAULT_MAX_TOTAL_ATTEMPTS,
  DEFAULT_TOTAL_TIMEOUT_MS,
  parseClientConfiguration,
} from "../../src/domain/configuration";
import {
  DEFAULT_PAGE_SIZE,
  normalizeErc20TransfersRequest,
  normalizeNativeBalanceRequest,
  normalizeChainReference,
  normalizeTransactionsRequest,
} from "../../src/domain/operations";
import type { NativeBalance, Page, Transaction } from "../../src/domain/models";

const mixedCaseAddress = "0x1234567890AbCdEf1234567890AbCdEf12345678";

describe("domain request contracts", () => {
  it("normalizes addresses and applies deterministic list defaults", () => {
    expect(
      normalizeTransactionsRequest({
        chain: " ETHEREUM ",
        address: mixedCaseAddress,
        startBlock: "00012",
        endBlock: "20",
      }),
    ).toEqual({
      operation: "getTransactions",
      chain: "ethereum",
      address: mixedCaseAddress.toLowerCase(),
      pageSize: DEFAULT_PAGE_SIZE,
      order: "desc",
      startBlock: "12",
      endBlock: "20",
      cursor: null,
    });
  });

  it("normalizes transfer filters and preserves an opaque cursor unchanged", () => {
    const cursor = "opaque.cursor/value";
    expect(
      normalizeErc20TransfersRequest({
        chain: 1,
        address: mixedCaseAddress,
        tokenAddress: "0x1234567890ABCDEF1234567890abcdef12345678",
        direction: "incoming",
        pageSize: 7,
        order: "asc",
        cursor,
      }),
    ).toEqual({
      operation: "getErc20Transfers",
      chain: 1,
      address: mixedCaseAddress.toLowerCase(),
      tokenAddress: "0x1234567890abcdef1234567890abcdef12345678",
      direction: "incoming",
      pageSize: 7,
      order: "asc",
      startBlock: null,
      endBlock: null,
      cursor,
    });
  });

  it("normalizes scalar requests without introducing a page", () => {
    expect(
      normalizeNativeBalanceRequest({ chain: "ethereum", address: mixedCaseAddress }),
    ).toEqual({
      operation: "getNativeBalance",
      chain: "ethereum",
      address: mixedCaseAddress.toLowerCase(),
    });
  });

  it("rejects malformed addresses, page sizes, and inverted block ranges", () => {
    for (const input of [
      { chain: 1, address: "0x123" },
      { chain: 1, address: mixedCaseAddress, pageSize: 0 },
      { chain: 1, address: mixedCaseAddress, pageSize: 101 },
      { chain: 1, address: mixedCaseAddress, startBlock: "9".repeat(79) },
      { chain: 1, address: mixedCaseAddress, startBlock: "10", endBlock: "9" },
    ]) {
      expect(() => normalizeTransactionsRequest(input)).toThrowError(
        expect.objectContaining({ code: "INVALID_REQUEST" }),
      );
    }
    expect(() => normalizeChainReference(0)).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  });

  it("keeps public blockchain quantities as decimal strings", () => {
    const balance: NativeBalance = {
      chainId: 1,
      address: mixedCaseAddress.toLowerCase(),
      amount: "9007199254740993",
      decimals: 18,
      symbol: "ETH",
      blockNumber: "20000000",
      provider: "etherscan",
    };
    expect(balance.amount).toBe("9007199254740993");
  });

  it("preserves documented null semantics in public page models", () => {
    const page: Page<Transaction> = {
      items: [
        {
          chainId: 1,
          hash: "0x1234",
          blockNumber: "20000000",
          blockHash: null,
          transactionIndex: null,
          timestamp: null,
          from: mixedCaseAddress.toLowerCase(),
          to: null,
          nonce: null,
          value: "0",
          gasLimit: null,
          gasUsed: null,
          gasPrice: null,
          input: null,
          status: "unknown",
          provider: "etherscan",
        },
      ],
      nextCursor: null,
      pageInfo: { provider: "etherscan", chainId: 1 },
    };

    expect(page.items[0]?.to).toBeNull();
    expect(page.nextCursor).toBeNull();
  });
});

describe("configuration contract", () => {
  it("normalizes defaults and freezes credential/configuration collections", () => {
    const configuration = parseClientConfiguration({
      providers: [{ kind: "etherscan", apiKeys: [" key-a "] }],
      requestPolicy: { providerPacingMs: { " ETHERSCAN ": 250 } },
    });

    expect(configuration.requestPolicy).toEqual({
      attemptTimeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
      totalTimeoutMs: DEFAULT_TOTAL_TIMEOUT_MS,
      maxTotalAttempts: DEFAULT_MAX_TOTAL_ATTEMPTS,
      allowDirect: true,
      providerPacingMs: { etherscan: 250 },
    });
    expect(configuration.providers[0]?.apiKeys).toEqual(["key-a"]);
    expect(Object.isFrozen(configuration)).toBe(true);
    expect(Object.isFrozen(configuration.providers)).toBe(true);
    expect(Object.isFrozen(configuration.providers[0])).toBe(true);
    expect(Object.isFrozen(configuration.providers[0]?.apiKeys)).toBe(true);

    expect(() =>
      parseClientConfiguration({
        providers: [{ kind: "etherscan", apiKeys: ["key"] }],
        requestPolicy: { providerPacingMs: { etherscan: 1, " ETHERSCAN ": 2 } },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
  });

  it("validates timeout relationships and approved endpoint/proxy protocols", () => {
    expect(() => parseClientConfiguration({ providers: [] })).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
    expect(() =>
      parseClientConfiguration({ providers: [{ kind: "etherscan", apiKeys: [] }] }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));

    expect(() =>
      parseClientConfiguration({
        providers: [{ kind: "alchemy", apiKeys: ["key"] }],
        requestPolicy: { attemptTimeoutMs: 20_000, totalTimeoutMs: 10_000 },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));

    expect(() =>
      parseClientConfiguration({
        providers: [{ kind: "alchemy", apiKeys: ["key"], baseUrl: "http://gateway.example" }],
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));

    expect(() =>
      parseClientConfiguration({
        providers: [{ kind: "alchemy", apiKeys: ["key"], baseUrl: "http://127.0.0.1:8545" }],
        proxies: [{ url: "socks5://127.0.0.1:1080" }],
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
    expect(() =>
      parseClientConfiguration({
        providers: [{ kind: "alchemy", apiKeys: ["key"] }],
        proxies: [{ url: "http://127.0.0.1:7890/path" }],
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));

    expect(() =>
      parseClientConfiguration({
        providers: [
          {
            kind: "alchemy",
            apiKeys: ["key"],
            baseUrl: "http://gateway.example",
            allowInsecureHttp: true,
          },
        ],
        proxies: [{ url: "http://user:password@127.0.0.1:7890" }],
      }),
    ).not.toThrow();
  });

  it("normalizes the explicit direct-route policy", () => {
    const configuration = parseClientConfiguration({
      providers: [{ kind: "etherscan", apiKeys: ["key"] }],
      requestPolicy: { allowDirect: false },
    });
    expect(configuration.requestPolicy.allowDirect).toBe(false);
  });
});

describe("typed domain errors", () => {
  it("exposes stable fields without changing the error category", () => {
    const error = new EvmDataError({
      code: "PROVIDER_UNAVAILABLE",
      message: "Provider unavailable.",
      retryable: true,
      provider: "etherscan",
      chainId: 1,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("EvmDataError");
    expect(error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(error.retryable).toBe(true);
    expect(error.provider).toBe("etherscan");
    expect(error.chainId).toBe(1);
    expect(error.cause).toBeUndefined();
  });

  it("keeps arbitrary causes out of public error inspection and serialization", () => {
    const error = new EvmDataError({
      code: "PROVIDER_UNAVAILABLE",
      message: "Provider unavailable.",
      retryable: true,
      cause: { message: "api-key-secret", authorization: "Bearer api-key-secret" },
    });

    expect(error.cause).toEqual({ type: "object" });
    expect(JSON.stringify(error)).not.toContain("api-key-secret");
  });
});
