import {
  archiveRpcUnavailable,
  isEvmDataError,
  rpcBlockNotFound,
  rpcBlockReorgDetected,
  rpcResponseInvalid,
} from "../domain/errors";
import type { EvmDataError } from "../domain/errors";
import type { RandomSource } from "../execution/clock";
import { ArchiveRpcTransport, isJsonRpcCallError, type ArchiveRpcCallOptions } from "./ArchiveRpcTransport";
import type { EthereumArchiveRpcEndpoint, EthereumArchiveRpcPool } from "./EthereumArchiveRpcPool";
import type { ArchiveRpcMulticallExecutor } from "./RpcService";

/**
 * Implements the `ArchiveRpcMulticallExecutor` port declared by `RpcService`
 * (P2). Owns endpoint pinning, the total time/attempt budget, and
 * restart-on-endpoint-failure (upgrade doc section 5.4). Has no Multicall3
 * ABI or Chainlink knowledge of its own; it only sends already-encoded
 * `aggregate3` call data as `eth_call` params and returns raw return data.
 */

export interface EthereumArchiveRpcExecutorOptions {
  readonly pool: EthereumArchiveRpcPool;
  readonly randomSource: RandomSource;
  readonly transport?: ArchiveRpcTransport;
  readonly attemptTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxRpcAttempts?: number;
  /** Bounded endpoint race width. Defaults to serial failover. */
  readonly maxConcurrentRpcAttempts?: number;
  /** Injectable clock for deterministic total-timeout tests. */
  readonly now?: () => number;
}

interface BlockHeader {
  readonly hash: string;
  /** Canonical non-negative base-10 Unix timestamp. */
  readonly timestamp: string;
}

const DEFAULT_ATTEMPT_TIMEOUT_MS = 10_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RPC_ATTEMPTS = 5;

export class EthereumArchiveRpcExecutor implements ArchiveRpcMulticallExecutor {
  private readonly pool: EthereumArchiveRpcPool;
  private readonly randomSource: RandomSource;
  private readonly transport: ArchiveRpcTransport;
  private readonly attemptTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly maxRpcAttempts: number;
  private readonly maxConcurrentRpcAttempts: number;
  private readonly now: () => number;

  constructor(options: EthereumArchiveRpcExecutorOptions) {
    this.pool = options.pool;
    this.randomSource = options.randomSource;
    this.transport = options.transport ?? new ArchiveRpcTransport();
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
    this.totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
    this.maxRpcAttempts = Math.max(1, options.maxRpcAttempts ?? DEFAULT_MAX_RPC_ATTEMPTS);
    this.maxConcurrentRpcAttempts = Math.max(
      1,
      Math.min(this.maxRpcAttempts, options.maxConcurrentRpcAttempts ?? 1),
    );
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Binary-searches for the highest block whose timestamp is less than or
   * equal to `targetTimestampSeconds`, matching the "before" semantics of
   * Etherscan's `getblocknobytime` endpoint. Pins the whole search to one
   * healthy endpoint from the pool, restarting on the next endpoint after a
   * retryable failure, same as `executeMulticallBatches`. Pure public RPC:
   * no indexed-API provider or API key is used.
   */
  async findBlockNumberByTimestamp(
    targetTimestampSeconds: bigint,
    lowerBoundBlock: bigint,
    signal?: AbortSignal,
  ): Promise<{ readonly blockNumber: string; readonly rpcEndpointId: string }> {
    const deadline = this.now() + this.totalTimeoutMs;
    const snapshot = await this.healthySnapshotWithRefresh(signal);
    if (snapshot.length === 0) {
      throw archiveRpcUnavailable("No healthy Ethereum Archive RPC endpoint is available.");
    }

    return this.runEndpointAttempts(snapshot, signal, deadline, async (endpoint, attemptSignal) => {
      const blockNumber = await this.binarySearchOnEndpoint(
        endpoint,
        targetTimestampSeconds,
        lowerBoundBlock,
        attemptSignal,
        deadline,
      );
      return { blockNumber: blockNumber.toString(10), rpcEndpointId: endpoint.id };
    });
  }

  /**
   * Reads the current chain head via pure public Archive RPC (`eth_getBlockByNumber`
   * with the `"latest"` tag). No indexed-API provider or API key is used.
   * Pins to one healthy endpoint, restarting on the next endpoint after a
   * retryable failure, same pattern as `findBlockNumberByTimestamp`.
   */
  async findLatestBlockNumber(signal?: AbortSignal): Promise<{ readonly blockNumber: string; readonly rpcEndpointId: string }> {
    const deadline = this.now() + this.totalTimeoutMs;
    const snapshot = await this.healthySnapshotWithRefresh(signal);
    if (snapshot.length === 0) {
      throw archiveRpcUnavailable("No healthy Ethereum Archive RPC endpoint is available.");
    }

    return this.runEndpointAttempts(snapshot, signal, deadline, async (endpoint, attemptSignal) => {
      const latest = await this.readBlockHeaderByTag(endpoint, "latest", attemptSignal, deadline);
      return { blockNumber: latest.number.toString(10), rpcEndpointId: endpoint.id };
    });
  }

  private async binarySearchOnEndpoint(
    endpoint: EthereumArchiveRpcEndpoint,
    targetTimestampSeconds: bigint,
    lowerBoundBlock: bigint,
    signal: AbortSignal | undefined,
    deadline: number,
  ): Promise<bigint> {
    const latest = await this.readBlockHeaderByTag(endpoint, "latest", signal, deadline);

    if (latest.timestamp <= targetTimestampSeconds) {
      return latest.number;
    }

    let low = lowerBoundBlock;
    let high = latest.number;
    const lowHeader = await this.readBlockHeader(endpoint, toBlockTag(low.toString(10)), signal, deadline);
    if (BigInt(lowHeader.timestamp) > targetTimestampSeconds) {
      // Target predates the lower bound entirely; return the lower bound
      // itself rather than searching further back.
      return low;
    }

    while (low < high) {
      const mid = low + (high - low + 1n) / 2n;
      const header = await this.readBlockHeader(endpoint, toBlockTag(mid.toString(10)), signal, deadline);
      if (BigInt(header.timestamp) <= targetTimestampSeconds) {
        low = mid;
      } else {
        high = mid - 1n;
      }
    }

    return low;
  }

  /**
   * Like `readBlockHeader`, but accepts any valid `eth_getBlockByNumber`
   * block tag (e.g. `"latest"`) instead of requiring a specific numeric
   * block, since the returned block number is not known ahead of the call.
   */
  private async readBlockHeaderByTag(
    endpoint: EthereumArchiveRpcEndpoint,
    blockTag: string,
    signal: AbortSignal | undefined,
    deadline: number,
  ): Promise<{ readonly number: bigint; readonly timestamp: bigint }> {
    const result = await this.call(endpoint, "eth_getBlockByNumber", [blockTag, false], signal, deadline);
    if (result === null) {
      throw rpcBlockNotFound(`Ethereum Archive RPC endpoint has no block at ${blockTag}.`);
    }
    if (result === undefined || typeof result !== "object") {
      throw rpcResponseInvalid("Ethereum Archive RPC endpoint returned a malformed block header.");
    }
    const block = result as { number?: unknown; timestamp?: unknown };
    if (typeof block.number !== "string" || !/^0x[0-9a-fA-F]+$/.test(block.number)) {
      throw rpcResponseInvalid("Ethereum Archive RPC endpoint returned a malformed block number.");
    }
    if (typeof block.timestamp !== "string" || !/^0x[0-9a-fA-F]+$/.test(block.timestamp)) {
      throw rpcResponseInvalid("Ethereum Archive RPC endpoint returned a malformed block timestamp.");
    }
    return { number: BigInt(block.number), timestamp: BigInt(block.timestamp) };
  }

  async executeMulticallBatches(request: {
    readonly blockNumber: string;
    readonly multicall3Address: string;
    readonly batches: readonly string[];
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly blockHash: string;
    readonly blockTimestamp: string;
    readonly rpcEndpointId: string;
    readonly batchReturnData: readonly string[];
  }> {
    const deadline = this.now() + this.totalTimeoutMs;
    const snapshot = await this.healthySnapshotWithRefresh(request.signal);
    if (snapshot.length === 0) {
      throw archiveRpcUnavailable("No healthy Ethereum Archive RPC endpoint is available.");
    }

    return this.runEndpointAttempts(snapshot, request.signal, deadline, (endpoint, attemptSignal) =>
      this.executeOnEndpoint(endpoint, { ...request, signal: attemptSignal }, deadline),
    );
  }

  /**
   * Reads an EOA's native balance at one exact block. This shares the archive
   * pool, bounded failover and pre/post block-hash assertion used by
   * multicall, so callers never need to construct an ad-hoc JSON-RPC client.
   */
  async getNativeBalanceAtBlock(request: {
    readonly address: string;
    readonly blockNumber: string;
    readonly signal?: AbortSignal;
  }): Promise<{
    readonly amount: string;
    readonly blockHash: string;
    readonly blockTimestamp: string;
    readonly rpcEndpointId: string;
  }> {
    const deadline = this.now() + this.totalTimeoutMs;
    const snapshot = await this.healthySnapshotWithRefresh(request.signal);
    if (snapshot.length === 0) {
      throw archiveRpcUnavailable("No healthy Ethereum Archive RPC endpoint is available.");
    }
    return this.runEndpointAttempts(snapshot, request.signal, deadline, (endpoint, attemptSignal) =>
      this.getNativeBalanceOnEndpoint(endpoint, { ...request, signal: attemptSignal }, deadline),
    );
  }

  private async healthySnapshotWithRefresh(signal?: AbortSignal): Promise<readonly EthereumArchiveRpcEndpoint[]> {
    const snapshot = this.pool.healthySnapshot(this.randomSource);
    if (snapshot.length > 0) return snapshot;
    const refresh = (this.pool as unknown as { refreshIfNeeded?: (signal?: AbortSignal) => Promise<void> }).refreshIfNeeded;
    if (refresh !== undefined) await refresh.call(this.pool, signal);
    return this.pool.healthySnapshot(this.randomSource);
  }

  /**
   * Race a small wave of independent endpoints. A successful request aborts
   * the remaining requests in that wave; only an all-failed wave advances to
   * more endpoints. The default width of one preserves legacy serial retry.
   */
  private async runEndpointAttempts<T>(
    snapshot: readonly EthereumArchiveRpcEndpoint[],
    signal: AbortSignal | undefined,
    deadline: number,
    operation: (endpoint: EthereumArchiveRpcEndpoint, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const endpoints = snapshot.slice(0, this.maxRpcAttempts);
    let lastError: unknown = archiveRpcUnavailable("No Ethereum Archive RPC attempt was made.");

    // Preserve the established serial behaviour exactly unless a caller
    // explicitly opts into endpoint races.
    if (this.maxConcurrentRpcAttempts === 1) {
      for (const endpoint of endpoints) {
        if (isAborted(signal)) throw lastError;
        if (this.now() >= deadline) {
          throw archiveRpcUnavailable("Ethereum Archive RPC total timeout was exceeded.");
        }
        try {
          const result = await operation(endpoint, signal ?? new AbortController().signal);
          this.pool.reportOutcome(endpoint.id, "success");
          return result;
        } catch (error: unknown) {
          this.pool.reportOutcome(endpoint.id, "failure");
          lastError = error;
          if (isAborted(signal) || !isRetryableFailure(error)) throw error;
        }
      }
      throw lastError;
    }

    for (let start = 0; start < endpoints.length; start += this.maxConcurrentRpcAttempts) {
      if (isAborted(signal)) throw lastError;
      if (this.now() >= deadline) {
        throw archiveRpcUnavailable("Ethereum Archive RPC total timeout was exceeded.");
      }

      const wave = endpoints.slice(start, start + this.maxConcurrentRpcAttempts);
      const controllers = wave.map(() => new AbortController());
      const abortWave = () => controllers.forEach((controller) => controller.abort());
      signal?.addEventListener("abort", abortWave, { once: true });
      let won = false;
      const failures: unknown[] = [];
      try {
        const result = await Promise.any(wave.map((endpoint, index) =>
          operation(endpoint, controllers[index]!.signal)
            .then((value) => {
              won = true;
              this.pool.reportOutcome(endpoint.id, "success");
              abortWave();
              return value;
            })
            .catch((error: unknown) => {
              if (!won && !controllers[index]!.signal.aborted) {
                this.pool.reportOutcome(endpoint.id, "failure");
                failures.push(error);
              }
              throw error;
            }),
        ));
        return result;
      } catch {
        const nonRetryable = failures.find((error) => !isRetryableFailure(error));
        if (signal?.aborted || nonRetryable !== undefined) {
          throw nonRetryable ?? failures.at(-1) ?? lastError;
        }
        lastError = failures.at(-1) ?? lastError;
      } finally {
        signal?.removeEventListener("abort", abortWave);
        abortWave();
      }
    }

    throw lastError;
  }

  private async executeOnEndpoint(
    endpoint: EthereumArchiveRpcEndpoint,
    request: {
      readonly blockNumber: string;
      readonly multicall3Address: string;
      readonly batches: readonly string[];
      readonly signal?: AbortSignal;
    },
    deadline: number,
  ): Promise<{
    readonly blockHash: string;
    readonly blockTimestamp: string;
    readonly rpcEndpointId: string;
    readonly batchReturnData: readonly string[];
  }> {
    const blockTag = toBlockTag(request.blockNumber);

    const preHeader = await this.readBlockHeader(endpoint, blockTag, request.signal, deadline);

    const batchReturnData: string[] = [];
    for (const batch of request.batches) {
      const returnData = await this.callAggregate3(
        endpoint,
        request.multicall3Address,
        batch,
        blockTag,
        request.signal,
        deadline,
      );
      batchReturnData.push(returnData);
    }

    const postHeader = await this.readBlockHeader(endpoint, blockTag, request.signal, deadline);
    if (preHeader.hash !== postHeader.hash) {
      throw rpcBlockReorgDetected(
        "Ethereum block hash changed while executing Multicall batches; discarding results.",
      );
    }

    return {
      blockHash: preHeader.hash,
      blockTimestamp: preHeader.timestamp,
      rpcEndpointId: endpoint.id,
      batchReturnData: Object.freeze(batchReturnData),
    };
  }

  private async getNativeBalanceOnEndpoint(
    endpoint: EthereumArchiveRpcEndpoint,
    request: {
      readonly address: string;
      readonly blockNumber: string;
      readonly signal?: AbortSignal;
    },
    deadline: number,
  ): Promise<{
    readonly amount: string;
    readonly blockHash: string;
    readonly blockTimestamp: string;
    readonly rpcEndpointId: string;
  }> {
    const blockTag = toBlockTag(request.blockNumber);
    const preHeader = await this.readBlockHeader(endpoint, blockTag, request.signal, deadline);
    const rawBalance = await this.call(
      endpoint,
      "eth_getBalance",
      [request.address, blockTag],
      request.signal,
      deadline,
    );
    if (typeof rawBalance !== "string" || !/^0x[0-9a-fA-F]+$/.test(rawBalance)) {
      throw rpcResponseInvalid("Ethereum Archive RPC endpoint returned a malformed native balance.");
    }
    const postHeader = await this.readBlockHeader(endpoint, blockTag, request.signal, deadline);
    if (preHeader.hash !== postHeader.hash) {
      throw rpcBlockReorgDetected(
        "Ethereum block hash changed while reading native balance; discarding result.",
      );
    }
    return {
      amount: BigInt(rawBalance).toString(10),
      blockHash: preHeader.hash,
      blockTimestamp: preHeader.timestamp,
      rpcEndpointId: endpoint.id,
    };
  }

  private async readBlockHeader(
    endpoint: EthereumArchiveRpcEndpoint,
    blockTag: string,
    signal: AbortSignal | undefined,
    deadline: number,
  ): Promise<BlockHeader> {
    const result = await this.call(endpoint, "eth_getBlockByNumber", [blockTag, false], signal, deadline);
    if (result === null) {
      throw rpcBlockNotFound(`Ethereum Archive RPC endpoint has no block at ${blockTag}.`);
    }
    if (result === undefined || typeof result !== "object") {
      throw rpcResponseInvalid("Ethereum Archive RPC endpoint returned a malformed block header.");
    }
    const block = result as { hash?: unknown; number?: unknown; timestamp?: unknown };
    if (typeof block.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(block.hash)) {
      throw rpcResponseInvalid("Ethereum Archive RPC endpoint returned a malformed block hash.");
    }
    if (typeof block.number !== "string" || !/^0x[0-9a-fA-F]+$/.test(block.number) || BigInt(block.number) !== BigInt(blockTag)) {
      throw rpcResponseInvalid("Ethereum Archive RPC endpoint returned a block header for the wrong block.");
    }
    if (typeof block.timestamp !== "string" || !/^0x[0-9a-fA-F]+$/.test(block.timestamp)) {
      throw rpcResponseInvalid("Ethereum Archive RPC endpoint returned a malformed block timestamp.");
    }
    return Object.freeze({ hash: block.hash, timestamp: BigInt(block.timestamp).toString(10) });
  }

  private async callAggregate3(
    endpoint: EthereumArchiveRpcEndpoint,
    multicall3Address: string,
    callData: string,
    blockTag: string,
    signal: AbortSignal | undefined,
    deadline: number,
  ): Promise<string> {
    const result = await this.call(
      endpoint,
      "eth_call",
      [{ to: multicall3Address, data: callData }, blockTag],
      signal,
      deadline,
    );
    if (typeof result !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(result)) {
      throw rpcResponseInvalid("Ethereum Archive RPC endpoint returned a malformed eth_call result.");
    }
    return result;
  }

  private async call(
    endpoint: EthereumArchiveRpcEndpoint,
    method: string,
    params: readonly unknown[],
    signal: AbortSignal | undefined,
    deadline: number,
  ): Promise<unknown> {
    const remainingMs = Math.max(1, deadline - this.now());
    const timeoutMs = Math.min(this.attemptTimeoutMs, remainingMs);
    const options: ArchiveRpcCallOptions = {
      endpointUrl: endpoint.url,
      method,
      params,
      timeoutMs,
      ...(signal === undefined ? {} : { signal }),
    };
    try {
      return await this.transport.call(options);
    } catch (error: unknown) {
      if (isJsonRpcCallError(error)) {
        // A well-formed node-level JSON-RPC error (for example missing
        // historical state, or a transient node-side failure) is an
        // endpoint-specific, retryable condition: try the next endpoint.
        throw archiveRpcUnavailable(
          `Ethereum Archive RPC endpoint returned a JSON-RPC error: ${error.rpcMessage}`,
          error,
        );
      }
      throw error;
    }
  }
}

function isRetryableFailure(error: unknown): boolean {
  return isEvmDataError(error) && error.retryable;
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

function toBlockTag(blockNumber: string): string {
  return `0x${BigInt(blockNumber).toString(16)}`;
}
