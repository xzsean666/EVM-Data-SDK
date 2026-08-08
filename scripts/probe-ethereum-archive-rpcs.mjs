/**
 * Opt-in maintainer command required by
 * `docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md` section 4.
 *
 * Usage:
 *   pnpm probe:ethereum-archive-rpcs
 *
 * For every candidate in `src/rpc/builtinEthereumArchiveRpcs.ts` this probes,
 * with direct HTTP only (no proxy is ever configured, so the runtime never
 * routes through `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY`):
 *
 *   1. `eth_chainId` returns `0x1`.
 *   2. `eth_getBlockByNumber("0x112a880", false)` returns block
 *      18,000,000 with a 32-byte hash and a valid timestamp.
 *   3. `eth_call` to Multicall3 `getBlockNumber()` at that block returns
 *      18,000,000.
 *   4. `eth_call` to the standard ETH/USD Chainlink proxy `latestRoundData()`
 *      at that block decodes with a positive answer and nonzero `updatedAt`.
 *
 * Each candidate is probed 3 times; a candidate only passes overall if every
 * repetition passes. This command prints only stable endpoint IDs and
 * pass/fail codes. It must never print endpoint URLs, response data, feed
 * prices, headers, or raw error messages that might echo a URL — every
 * failure is reduced to one of this file's own stable `ProbeError` codes
 * before being logged.
 *
 * This script intentionally reuses the pure, network-free codec modules
 * under `src/` (no HTTP/proxy/endpoint knowledge of their own) so the ABI
 * mechanics it exercises are exactly the ones the SDK itself uses.
 */

import { decodeLatestRoundData, LATEST_ROUND_DATA_SELECTOR } from "../src/chainlink/ChainlinkRoundDataCodec.ts";
import {
  decodeGetBlockNumberResult,
  MULTICALL3_ADDRESS,
  MULTICALL3_GET_BLOCK_NUMBER_SELECTOR,
} from "../src/rpc/EthereumMulticall3Codec.ts";
import { BUILTIN_ETHEREUM_ARCHIVE_RPCS } from "../src/rpc/builtinEthereumArchiveRpcs.ts";

const REPEAT_COUNT = 3;
const TIMEOUT_MS = Number(process.env.EVM_SDK_PROBE_TIMEOUT_MS ?? 10_000);

const CHAIN_ID_HEX = "0x1";
const HISTORICAL_BLOCK_HEX = "0x112a880";
const HISTORICAL_BLOCK_DECIMAL = 18_000_000n;
const MULTICALL3_GET_BLOCK_NUMBER_CALL_DATA = `0x${MULTICALL3_GET_BLOCK_NUMBER_SELECTOR}`;
const ETH_USD_CHAINLINK_PROXY_ADDRESS = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";

class ProbeError extends Error {
  constructor(code) {
    super(code);
    this.name = "ProbeError";
    this.code = code;
  }
}

/** Races a promise against a timer built only from allowed globals (no AbortController). */
function withTimeout(promise, timeoutMs, timeoutCode) {
  let timer;
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new ProbeError(timeoutCode)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Sends one direct JSON-RPC 2.0 request. Never configures a proxy, never
 * reads a proxy environment variable, and never lets a raw transport error
 * message (which could echo the endpoint URL) escape this function.
 */
async function rpcRequest(url, method, params, timeoutMs) {
  let response;
  try {
    response = await withTimeout(
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
      timeoutMs,
      "TIMEOUT",
    );
  } catch (error) {
    if (error instanceof ProbeError) throw error;
    throw new ProbeError("NETWORK_ERROR");
  }

  if (!response.ok) {
    throw new ProbeError(`HTTP_ERROR_${response.status}`);
  }

  let body;
  try {
    body = await response.json();
  } catch {
    throw new ProbeError("INVALID_JSON");
  }

  if (body === null || typeof body !== "object") {
    throw new ProbeError("INVALID_RESPONSE");
  }
  if (body.error !== undefined) {
    throw new ProbeError("RPC_ERROR");
  }
  if (body.result === undefined) {
    throw new ProbeError("INVALID_RESPONSE");
  }
  return body.result;
}

async function checkChainId(url, timeoutMs) {
  const result = await rpcRequest(url, "eth_chainId", [], timeoutMs);
  if (result !== CHAIN_ID_HEX) {
    throw new ProbeError("CHAIN_ID_MISMATCH");
  }
}

async function checkHistoricalBlock(url, timeoutMs) {
  const block = await rpcRequest(url, "eth_getBlockByNumber", [HISTORICAL_BLOCK_HEX, false], timeoutMs);
  if (block === null || typeof block !== "object") {
    throw new ProbeError("BLOCK_MISSING");
  }
  if (block.number !== HISTORICAL_BLOCK_HEX) {
    throw new ProbeError("BLOCK_NUMBER_MISMATCH");
  }
  if (typeof block.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(block.hash)) {
    throw new ProbeError("BLOCK_HASH_INVALID");
  }
  if (typeof block.timestamp !== "string" || !/^0x[0-9a-fA-F]+$/.test(block.timestamp) || BigInt(block.timestamp) <= 0n) {
    throw new ProbeError("BLOCK_TIMESTAMP_INVALID");
  }
}

async function checkMulticallBlockNumber(url, timeoutMs) {
  const returnData = await rpcRequest(
    url,
    "eth_call",
    [{ to: MULTICALL3_ADDRESS, data: MULTICALL3_GET_BLOCK_NUMBER_CALL_DATA }, HISTORICAL_BLOCK_HEX],
    timeoutMs,
  );
  let value;
  try {
    value = decodeGetBlockNumberResult(returnData);
  } catch {
    throw new ProbeError("MULTICALL_DECODE_FAILED");
  }
  if (value !== HISTORICAL_BLOCK_DECIMAL) {
    throw new ProbeError("MULTICALL_BLOCK_MISMATCH");
  }
}

async function checkChainlinkFeed(url, timeoutMs) {
  const returnData = await rpcRequest(
    url,
    "eth_call",
    [{ to: ETH_USD_CHAINLINK_PROXY_ADDRESS, data: LATEST_ROUND_DATA_SELECTOR }, HISTORICAL_BLOCK_HEX],
    timeoutMs,
  );
  let decoded;
  try {
    decoded = decodeLatestRoundData(returnData);
  } catch {
    throw new ProbeError("FEED_DECODE_FAILED");
  }
  if (decoded.answer <= 0n) {
    throw new ProbeError("FEED_ANSWER_NOT_POSITIVE");
  }
  if (decoded.updatedAt <= 0n) {
    throw new ProbeError("FEED_UPDATED_AT_ZERO");
  }
}

async function runSingleProbe(url, timeoutMs) {
  await checkChainId(url, timeoutMs);
  await checkHistoricalBlock(url, timeoutMs);
  await checkMulticallBlockNumber(url, timeoutMs);
  await checkChainlinkFeed(url, timeoutMs);
}

async function probeCandidate(candidate) {
  const iterationResults = [];
  for (let iteration = 1; iteration <= REPEAT_COUNT; iteration += 1) {
    try {
      // Intentionally sequential: repeat probes must not race each other.
      await runSingleProbe(candidate.url, TIMEOUT_MS);
      iterationResults.push("pass");
      console.log(JSON.stringify({ id: candidate.id, iteration, status: "pass" }));
    } catch (error) {
      const code = error instanceof ProbeError ? error.code : "UNEXPECTED_ERROR";
      iterationResults.push("fail");
      console.log(JSON.stringify({ id: candidate.id, iteration, status: "fail", code }));
    }
  }
  const overall = iterationResults.every((status) => status === "pass") ? "pass" : "fail";
  console.log(JSON.stringify({ id: candidate.id, overall }));
  return { id: candidate.id, overall };
}

async function main() {
  console.log(
    JSON.stringify({
      phase: "start",
      candidateCount: BUILTIN_ETHEREUM_ARCHIVE_RPCS.length,
      repeatCount: REPEAT_COUNT,
      timeoutMs: TIMEOUT_MS,
    }),
  );

  const results = [];
  for (const candidate of BUILTIN_ETHEREUM_ARCHIVE_RPCS) {
    // Candidates are probed one at a time by design.
    results.push(await probeCandidate(candidate));
  }

  const failed = results.filter((entry) => entry.overall !== "pass");
  console.log(JSON.stringify({ phase: "summary", passCount: results.length - failed.length, failCount: failed.length }));
  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ phase: "fatal", code: error instanceof ProbeError ? error.code : "UNEXPECTED_ERROR" }));
  process.exitCode = 1;
});
