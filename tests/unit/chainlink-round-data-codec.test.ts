import { describe, expect, it } from "vitest";

import {
  DECIMALS_SELECTOR,
  LATEST_ROUND_DATA_SELECTOR,
  decodeDecimals,
  decodeLatestRoundData,
  formatFixedPointPrice,
} from "../../src/chainlink/ChainlinkRoundDataCodec";

function wordUint(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}

function wordInt(value: bigint): string {
  const normalized = value < 0n ? value + (1n << 256n) : value;
  return normalized.toString(16).padStart(64, "0");
}

describe("ChainlinkRoundDataCodec selectors", () => {
  it("exposes the documented AggregatorV3Interface selectors", () => {
    expect(LATEST_ROUND_DATA_SELECTOR).toBe("0xfeaf968c");
    expect(DECIMALS_SELECTOR).toBe("0x313ce567");
  });
});

describe("ChainlinkRoundDataCodec.decodeLatestRoundData", () => {
  it("decodes a positive answer and canonical round data", () => {
    const encoded = `0x${wordUint(18446744073709562300n)}${wordInt(300000000000n)}${wordUint(1700000000n)}${wordUint(1700000060n)}${wordUint(18446744073709562300n)}`;
    const decoded = decodeLatestRoundData(encoded);
    expect(decoded).toEqual({
      roundId: 18446744073709562300n,
      answer: 300000000000n,
      startedAt: 1700000000n,
      updatedAt: 1700000060n,
      answeredInRound: 18446744073709562300n,
    });
  });

  it("decodes a negative answer with two's-complement semantics", () => {
    const encoded = `0x${wordUint(1n)}${wordInt(-42n)}${wordUint(1n)}${wordUint(2n)}${wordUint(1n)}`;
    const decoded = decodeLatestRoundData(encoded);
    expect(decoded.answer).toBe(-42n);
  });

  it("decodes zero timestamps (round never started/updated)", () => {
    const encoded = `0x${wordUint(0n)}${wordInt(0n)}${wordUint(0n)}${wordUint(0n)}${wordUint(0n)}`;
    const decoded = decodeLatestRoundData(encoded);
    expect(decoded.startedAt).toBe(0n);
    expect(decoded.updatedAt).toBe(0n);
  });

  it("rejects a tuple that is not exactly five words", () => {
    expect(() => decodeLatestRoundData(`0x${wordUint(1n)}`)).toThrow();
    expect(() =>
      decodeLatestRoundData(`0x${wordUint(1n)}${wordUint(1n)}${wordUint(1n)}${wordUint(1n)}${wordUint(1n)}00`),
    ).toThrow();
  });

  it("rejects malformed non-hex return data", () => {
    expect(() => decodeLatestRoundData("0xzz")).toThrow();
    expect(() => decodeLatestRoundData("0xabc")).toThrow();
  });
});

describe("ChainlinkRoundDataCodec.decodeDecimals", () => {
  it("decodes a typical 8-decimal feed", () => {
    expect(decodeDecimals(`0x${wordUint(8n)}`)).toBe(8);
  });

  it("decodes the boundary values 0 and 255", () => {
    expect(decodeDecimals(`0x${wordUint(0n)}`)).toBe(0);
    expect(decodeDecimals(`0x${wordUint(255n)}`)).toBe(255);
  });

  it("rejects a value outside uint8 range", () => {
    expect(() => decodeDecimals(`0x${wordUint(256n)}`)).toThrow();
  });

  it("rejects a payload that is not exactly one word", () => {
    expect(() => decodeDecimals("0x08")).toThrow();
    expect(() => decodeDecimals(`0x${wordUint(1n)}${wordUint(1n)}`)).toThrow();
  });
});

describe("ChainlinkRoundDataCodec.formatFixedPointPrice", () => {
  it("formats a typical 8-decimal ETH/USD price without floating point", () => {
    expect(formatFixedPointPrice(300000000000n, 8)).toBe("3000");
  });

  it("preserves a fractional remainder and trims trailing zeros", () => {
    expect(formatFixedPointPrice(300012345678n, 8)).toBe("3000.12345678");
    expect(formatFixedPointPrice(300010000000n, 8)).toBe("3000.1");
  });

  it("formats a value smaller than one unit with leading zero padding", () => {
    expect(formatFixedPointPrice(5n, 8)).toBe("0.00000005");
  });

  it("formats zero decimals as a plain integer", () => {
    expect(formatFixedPointPrice(42n, 0)).toBe("42");
  });

  it("formats zero as a plain integer regardless of decimals", () => {
    expect(formatFixedPointPrice(0n, 8)).toBe("0");
  });

  it("rejects a negative rawAnswer", () => {
    expect(() => formatFixedPointPrice(-1n, 8)).toThrow();
  });

  it("rejects an invalid decimals value", () => {
    expect(() => formatFixedPointPrice(1n, -1)).toThrow();
    expect(() => formatFixedPointPrice(1n, 256)).toThrow();
    expect(() => formatFixedPointPrice(1n, 1.5)).toThrow();
  });
});
