import { describe, expect, it } from "vitest";

import {
  assertCursorMatches,
  decodeCursor,
  encodeCursor,
  queryFingerprint,
} from "../../src/execution/cursorCodec";
import { normalizeErc20TransfersRequest, normalizeTransactionsRequest } from "../../src/domain/operations";
import type { CursorIdentity } from "../../src/domain/pagination";

const address = "0x1234567890abcdef1234567890abcdef12345678";

describe("cursor codec", () => {
  it("round-trips a bounded provider-pinned cursor and freezes decoded state", () => {
    const request = normalizeTransactionsRequest({
      chain: "ethereum",
      address,
      pageSize: 25,
      order: "asc",
      startBlock: "10",
      endBlock: "20",
    });
    const identity: CursorIdentity = {
      version: 1,
      operation: request.operation,
      provider: "etherscan",
      providerConfigurationId: "etherscan-main",
      chainId: 1,
      queryFingerprint: queryFingerprint(request, 1),
      providerPageState: { page: 2, offset: 25, order: "asc" },
    };

    const decoded = decodeCursor(encodeCursor(identity));
    expect(decoded).toEqual(identity);
    expect(Object.isFrozen(decoded)).toBe(true);
    expect(Object.isFrozen(decoded.providerPageState)).toBe(true);
  });

  it("rejects corrupt, oversized, non-canonical, and unknown-version cursors", () => {
    expect(() => decodeCursor("not a cursor")).toThrowError(
      expect.objectContaining({ code: "INVALID_CURSOR" }),
    );
    expect(() => decodeCursor("a".repeat(4097))).toThrowError(
      expect.objectContaining({ code: "INVALID_CURSOR" }),
    );

    const unknownVersion = Buffer.from(
      JSON.stringify({
        version: 2,
        operation: "getNativeBalance",
        provider: "etherscan",
        providerConfigurationId: "etherscan-main",
        chainId: 1,
        queryFingerprint: "a".repeat(43),
        providerPageState: null,
      }),
      "utf8",
    ).toString("base64url");
    expect(() => decodeCursor(unknownVersion)).toThrowError(
      expect.objectContaining({ code: "INVALID_CURSOR" }),
    );

    const padded = `${encodeCursor({
      version: 1,
      operation: "getNativeBalance",
      provider: "etherscan",
      providerConfigurationId: "etherscan-main",
      chainId: 1,
      queryFingerprint: "a".repeat(43),
      providerPageState: null,
    })}=`;
    expect(() => decodeCursor(padded)).toThrowError(
      expect.objectContaining({ code: "INVALID_CURSOR" }),
    );
  });

  it("rejects secret-bearing, URL-bearing, circular, and too-large paging state", () => {
    const base: CursorIdentity = {
      version: 1,
      operation: "getNativeBalance",
      provider: "etherscan",
      providerConfigurationId: "etherscan-main",
      chainId: 1,
      queryFingerprint: "a".repeat(43),
      providerPageState: null,
    };
    expect(() => encodeCursor({ ...base, providerPageState: { apiKey: "secret" } })).toThrowError(
      expect.objectContaining({ code: "INVALID_CURSOR" }),
    );
    expect(() => encodeCursor({ ...base, provider: "https://provider.example" })).toThrowError(
      expect.objectContaining({ code: "INVALID_CURSOR" }),
    );
    expect(() => encodeCursor({ ...base, providerPageState: { url: "https://provider.example" } })).toThrowError(
      expect.objectContaining({ code: "INVALID_CURSOR" }),
    );
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => encodeCursor({ ...base, providerPageState: circular })).toThrowError(
      expect.objectContaining({ code: "INVALID_CURSOR" }),
    );
    expect(() => encodeCursor({ ...base, providerPageState: "x".repeat(2049) })).toThrowError(
      expect.objectContaining({ code: "INVALID_CURSOR" }),
    );
  });

  it("fingerprints semantic filters deterministically while excluding cursor and signal", () => {
    const first = normalizeErc20TransfersRequest({
      chain: "ethereum",
      address,
      tokenAddress: address,
      direction: "incoming",
      pageSize: 10,
      order: "desc",
      startBlock: "0001",
      endBlock: "20",
      cursor: "provider-cursor-a",
    });
    const equivalent = normalizeErc20TransfersRequest({
      chain: 1,
      address,
      tokenAddress: address,
      direction: "incoming",
      pageSize: 10,
      order: "desc",
      startBlock: "1",
      endBlock: "20",
      cursor: "provider-cursor-b",
    });
    const changed = normalizeErc20TransfersRequest({
      chain: 1,
      address,
      tokenAddress: address,
      direction: "outgoing",
      pageSize: 10,
      order: "desc",
      startBlock: "1",
      endBlock: "20",
    });

    expect(queryFingerprint(first, 1)).toBe(queryFingerprint(equivalent, 1));
    expect(queryFingerprint(first, 1)).not.toBe(queryFingerprint(changed, 1));
    expect(() =>
      assertCursorMatches(
        {
          version: 1,
          operation: first.operation,
          provider: "etherscan",
          providerConfigurationId: "etherscan-main",
          chainId: 1,
          queryFingerprint: queryFingerprint(first, 1),
          providerPageState: null,
        },
        { operation: changed.operation, chainId: 1, queryFingerprint: queryFingerprint(changed, 1) },
      ),
    ).toThrowError(expect.objectContaining({ code: "INVALID_CURSOR" }));
  });
});
