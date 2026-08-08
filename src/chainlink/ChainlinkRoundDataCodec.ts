/**
 * Pure Chainlink `AggregatorV3Interface` ABI encode/decode.
 *
 * This module owns exact ABI mechanics for `latestRoundData()` and
 * `decimals()` only. It has no network, retry, endpoint, or Multicall
 * batching knowledge, and it must not import an HTTP transport. Callers
 * (`ChainlinkService`) decide how to batch these calls and how to map a
 * decode/validation failure onto a per-feed `ChainlinkFeedFailure`.
 */

/** `latestRoundData()` 4-byte selector. */
export const LATEST_ROUND_DATA_SELECTOR = "0xfeaf968c";

/** `decimals()` 4-byte selector. */
export const DECIMALS_SELECTOR = "0x313ce567";

export interface LatestRoundData {
  readonly roundId: bigint;
  readonly answer: bigint;
  readonly startedAt: bigint;
  readonly updatedAt: bigint;
  readonly answeredInRound: bigint;
}

/**
 * Decodes the static tuple
 * `(uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)`
 * returned by `latestRoundData()`. All five fields are 32-byte words with no
 * dynamic offsets. `answer` is two's-complement signed.
 */
export function decodeLatestRoundData(returnData: string): LatestRoundData {
  const hex = normalizeHex(returnData);
  if (hex.length !== 5 * 64) {
    throw new Error("Chainlink latestRoundData() return data must be exactly five 32-byte words.");
  }

  const wordAt = (index: number): string => hex.slice(index * 64, (index + 1) * 64);

  return Object.freeze({
    roundId: BigInt(`0x${wordAt(0)}`),
    answer: decodeInt256(wordAt(1)),
    startedAt: BigInt(`0x${wordAt(2)}`),
    updatedAt: BigInt(`0x${wordAt(3)}`),
    answeredInRound: BigInt(`0x${wordAt(4)}`),
  });
}

/**
 * Decodes the `uint8` returned by `decimals()`. Chainlink feeds always
 * return this value right-aligned in one 32-byte word.
 */
export function decodeDecimals(returnData: string): number {
  const hex = normalizeHex(returnData);
  if (hex.length !== 64) {
    throw new Error("Chainlink decimals() return data must be exactly one 32-byte word.");
  }
  const value = BigInt(`0x${hex}`);
  if (value < 0n || value > 255n) {
    throw new Error("Chainlink decimals() value must be an integer from 0 through 255.");
  }
  return Number(value);
}

/**
 * Converts an exact integer `rawAnswer`/`decimals` pair into a canonical
 * base-10 fixed-point decimal string without floating-point arithmetic or
 * exponent notation. `rawAnswer` must already be validated as positive.
 */
export function formatFixedPointPrice(rawAnswer: bigint, decimals: number): string {
  if (rawAnswer < 0n) {
    throw new Error("formatFixedPointPrice requires a non-negative rawAnswer.");
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new Error("formatFixedPointPrice requires decimals to be an integer from 0 through 255.");
  }
  if (decimals === 0) {
    return rawAnswer.toString();
  }
  const digits = rawAnswer.toString().padStart(decimals + 1, "0");
  const integerPart = digits.slice(0, digits.length - decimals);
  const fractionalPart = digits.slice(digits.length - decimals).replace(/0+$/, "");
  return fractionalPart.length === 0 ? integerPart : `${integerPart}.${fractionalPart}`;
}

function decodeInt256(word: string): bigint {
  const value = BigInt(`0x${word}`);
  const signBit = 1n << 255n;
  const modulus = 1n << 256n;
  return value & signBit ? value - modulus : value;
}

function normalizeHex(value: string): string {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new Error("Chainlink ABI return data must be even-length hex.");
  }
  return value.slice(2).toLowerCase();
}
