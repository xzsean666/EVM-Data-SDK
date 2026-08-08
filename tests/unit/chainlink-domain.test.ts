import { describe, expect, it } from "vitest";

import { parseClientConfiguration } from "../../src/domain/configuration";
import {
  parseMulticallAtBlockRequest,
  MAX_MULTICALL_CALLS_PER_REQUEST,
} from "../../src/domain/rpcModels";
import { parseChainlinkTokenPricesAtBlockRequest } from "../../src/domain/chainlinkModels";

const multicall3Address = "0xcA11bde05977b3631167028862bE2a173976CA11";

describe("chainlink client configuration (v0.4, ADR-028/ADR-029)", () => {
  it("accepts a Chainlink-only client configuration with no providers and no price block", () => {
    const configuration = parseClientConfiguration({
      chainlink: { enabled: true },
    });

    expect(configuration.chainlink.enabled).toBe(true);
    expect(configuration.chainlink.useBuiltinEthereumArchiveRpcs).toBe(true);
    expect(configuration.providers).toEqual([]);
    expect(Object.isFrozen(configuration.chainlink)).toBe(true);
  });

  it("defaults chainlink to disabled and builtin-off when omitted, without rejecting an unrelated client", () => {
    const configuration = parseClientConfiguration({
      providers: [{ kind: "etherscan", apiKeys: ["key"] }],
    });

    expect(configuration.chainlink.enabled).toBe(false);
    expect(configuration.chainlink.useBuiltinEthereumArchiveRpcs).toBe(false);
    expect(configuration.chainlink.rpcEndpoints).toEqual([]);
  });

  it("still rejects a client with no providers, no price providers, and chainlink disabled", () => {
    expect(() => parseClientConfiguration({})).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
    expect(() => parseClientConfiguration({ chainlink: { enabled: false } })).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
  });

  it("rejects duplicate rpcEndpoints ids", () => {
    expect(() =>
      parseClientConfiguration({
        chainlink: {
          enabled: true,
          useBuiltinEthereumArchiveRpcs: false,
          rpcEndpoints: [
            { id: "custom-a", url: "https://rpc.example/a" },
            { id: "custom-a", url: "https://rpc.example/b" },
          ],
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
  });

  it("rejects duplicate rpcEndpoints urls even with distinct ids", () => {
    expect(() =>
      parseClientConfiguration({
        chainlink: {
          enabled: true,
          useBuiltinEthereumArchiveRpcs: false,
          rpcEndpoints: [
            { id: "custom-a", url: "https://rpc.example/a" },
            { id: "custom-b", url: "https://rpc.example/a" },
          ],
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
  });

  it("rejects a non-HTTPS rpcEndpoints url", () => {
    expect(() =>
      parseClientConfiguration({
        chainlink: {
          enabled: true,
          useBuiltinEthereumArchiveRpcs: false,
          rpcEndpoints: [{ id: "custom-a", url: "http://rpc.example/a" }],
        },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
  });

  it("rejects enabling chainlink with builtins off and no custom endpoints", () => {
    expect(() =>
      parseClientConfiguration({
        chainlink: { enabled: true, useBuiltinEthereumArchiveRpcs: false, rpcEndpoints: [] },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
  });

  it("rejects an inverted chainlink timeout relationship", () => {
    expect(() =>
      parseClientConfiguration({
        chainlink: { enabled: true, attemptTimeoutMs: 20_000, totalTimeoutMs: 10_000 },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
  });

  it("rejects unknown keys under chainlink (strict schema)", () => {
    expect(() =>
      parseClientConfiguration({
        chainlink: { enabled: true, unknownField: true },
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CONFIGURATION" }));
  });

  it("never leaks a configured endpoint URL through a thrown error message", () => {
    const secretUrl = "https://rpc.example/super-secret-token-abc123";
    try {
      parseClientConfiguration({
        chainlink: {
          enabled: true,
          useBuiltinEthereumArchiveRpcs: false,
          rpcEndpoints: [
            { id: "custom-a", url: secretUrl },
            { id: "custom-b", url: secretUrl },
          ],
        },
      });
      throw new Error("expected parseClientConfiguration to throw");
    } catch (error) {
      expect(String((error as Error).message)).not.toContain(secretUrl);
      expect(String((error as Error).message)).not.toContain("super-secret-token-abc123");
    }
  });
});

describe("multicallAtBlock request contract (public, provider-neutral)", () => {
  it("normalizes decimal block numbers and lower-cases addresses/call data", () => {
    const request = parseMulticallAtBlockRequest({
      chain: 1,
      blockNumber: "0018000000",
      calls: [
        { id: "call-1", target: multicall3Address, callData: "0xFEAF968C" },
      ],
    });

    expect(request.chainId).toBe(1);
    expect(request.blockNumber).toBe("18000000");
    expect(request.calls[0]?.target).toBe(multicall3Address.toLowerCase());
    expect(request.calls[0]?.callData).toBe("0xfeaf968c");
    expect(request.calls[0]?.allowFailure).toBe(true);
    expect(Object.isFrozen(request.calls)).toBe(true);
  });

  it("rejects duplicate call ids", () => {
    expect(() =>
      parseMulticallAtBlockRequest({
        chain: 1,
        blockNumber: "1",
        calls: [
          { id: "dup", target: multicall3Address, callData: "0x" },
          { id: "dup", target: multicall3Address, callData: "0x" },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it("rejects an empty calls array and a batch above the maximum", () => {
    expect(() =>
      parseMulticallAtBlockRequest({ chain: 1, blockNumber: "1", calls: [] }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));

    const tooMany = Array.from({ length: MAX_MULTICALL_CALLS_PER_REQUEST + 1 }, (_, index) => ({
      id: `call-${index}`,
      target: multicall3Address,
      callData: "0x",
    }));
    expect(() =>
      parseMulticallAtBlockRequest({ chain: 1, blockNumber: "1", calls: tooMany }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });

  it("rejects a malformed target address and odd-length call data", () => {
    expect(() =>
      parseMulticallAtBlockRequest({
        chain: 1,
        blockNumber: "1",
        calls: [{ id: "call-1", target: "0x123", callData: "0x" }],
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));

    expect(() =>
      parseMulticallAtBlockRequest({
        chain: 1,
        blockNumber: "1",
        calls: [{ id: "call-1", target: multicall3Address, callData: "0xabc" }],
      }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });
});

describe("chainlink getTokenPricesAtBlock request contract", () => {
  it("normalizes a decimal block number without a token selector field", () => {
    const request = parseChainlinkTokenPricesAtBlockRequest({ blockNumber: "0020000000" });
    expect(request.blockNumber).toBe("20000000");
  });

  it("rejects a negative or non-decimal block number", () => {
    expect(() => parseChainlinkTokenPricesAtBlockRequest({ blockNumber: "-1" })).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
    expect(() => parseChainlinkTokenPricesAtBlockRequest({ blockNumber: "abc" })).toThrowError(
      expect.objectContaining({ code: "INVALID_REQUEST" }),
    );
  });

  it("rejects an unexpected token-selector field (no token argument in v0.4)", () => {
    expect(() =>
      parseChainlinkTokenPricesAtBlockRequest({ blockNumber: "1", token: "ETH" }),
    ).toThrowError(expect.objectContaining({ code: "INVALID_REQUEST" }));
  });
});
