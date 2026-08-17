import {
  archiveRpcUnavailable,
  isEvmDataError,
  rpcResponseInvalid,
} from "../domain/errors";
import type { RandomSource } from "../execution/clock";
import { systemRandom } from "../execution/clock";
import {
  parseJsonRpcRequests,
  type JsonRpcBatchExecutionOptions,
  type JsonRpcBatchItemResult,
  type JsonRpcRequest,
  type NormalizedJsonRpcRequest,
} from "../domain/jsonRpcModels";
import {
  ArchiveRpcTransport,
  isJsonRpcCallError,
  type JsonRpcBatchResponseItem,
} from "./ArchiveRpcTransport";

export interface RpcEndpoint {
  readonly id: string;
  readonly url: string;
}

export interface RpcPoolLike {
  healthySnapshot(randomSource: RandomSource): readonly RpcEndpoint[];
  reportOutcome(id: string, outcome: "success" | "failure"): void;
  refreshIfNeeded?(signal?: AbortSignal): Promise<void>;
}

export interface JsonRpcBatchExecutorOptions {
  readonly pool: RpcPoolLike;
  readonly randomSource?: RandomSource;
  readonly transport?: ArchiveRpcTransport;
  readonly attemptTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxRpcAttempts?: number;
  readonly defaultBatchChunkSize?: number;
  readonly defaultMaxConcurrency?: number;
  readonly now?: () => number;
}

const DEFAULT_ATTEMPT_TIMEOUT_MS = 10_000;
const DEFAULT_TOTAL_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RPC_ATTEMPTS = 5;
const DEFAULT_BATCH_CHUNK_SIZE = 100;
const DEFAULT_MAX_CONCURRENCY = 3;

/**
 * High-performance, fault-tolerant generic JSON-RPC batch executor.
 *
 * Features:
 * - Load-balancing: Randomly selects healthy RPC endpoints from the pool per batch/chunk.
 * - Automatic chunking: Splits large batches to stay within node batch limits.
 * - Bounded concurrency: Runs chunk requests in parallel with configurable concurrency.
 * - Automatic failover: Retries with the next healthy endpoint if an RPC endpoint fails.
 * - Out-of-order reconciliation: Accurately maps responses back to original requests by ID.
 * - Type-safe results: Returns discriminated union with per-item success/failure or strict mode.
 */
export class JsonRpcBatchExecutor {
  private readonly pool: RpcPoolLike;
  private readonly randomSource: RandomSource;
  private readonly transport: ArchiveRpcTransport;
  private readonly attemptTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly maxRpcAttempts: number;
  private readonly defaultBatchChunkSize: number;
  private readonly defaultMaxConcurrency: number;
  private readonly now: () => number;

  constructor(options: JsonRpcBatchExecutorOptions) {
    this.pool = options.pool;
    this.randomSource = options.randomSource ?? systemRandom;
    this.transport = options.transport ?? new ArchiveRpcTransport();
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
    this.totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
    this.maxRpcAttempts = Math.max(1, options.maxRpcAttempts ?? DEFAULT_MAX_RPC_ATTEMPTS);
    this.defaultBatchChunkSize = Math.max(1, options.defaultBatchChunkSize ?? DEFAULT_BATCH_CHUNK_SIZE);
    this.defaultMaxConcurrency = Math.max(1, options.defaultMaxConcurrency ?? DEFAULT_MAX_CONCURRENCY);
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * Executes a batch of arbitrary JSON-RPC requests across the RPC pool.
   * Large request arrays are automatically chunked and executed with bounded concurrency.
   * Returns item-level results allowing callers to inspect individual successes and reverts.
   */
  async executeBatch<TResult = unknown>(
    requests: readonly JsonRpcRequest[],
    options?: JsonRpcBatchExecutionOptions,
  ): Promise<readonly JsonRpcBatchItemResult<TResult>[]> {
    const normalized = parseJsonRpcRequests(requests, {
      batchChunkSize: options?.batchChunkSize ?? this.defaultBatchChunkSize,
      maxConcurrency: options?.maxConcurrency ?? this.defaultMaxConcurrency,
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });

    if (normalized.requests.length === 0) {
      return Object.freeze([]);
    }

    const deadline = this.now() + this.totalTimeoutMs;
    const chunks = chunk(normalized.requests, normalized.batchChunkSize);
    const chunkResults: (readonly JsonRpcBatchResponseItem[])[] = new Array(chunks.length);

    await runBounded(chunks, normalized.maxConcurrency, async (chunkSlice, chunkIndex) => {
      const chunkResult = await this.executeChunkWithFailover(
        chunkSlice,
        normalized.signal,
        deadline,
      );
      chunkResults[chunkIndex] = chunkResult;
    });

    const allResults: JsonRpcBatchItemResult<TResult>[] = [];
    for (const batch of chunkResults) {
      for (const item of batch) {
        if (item.success) {
          allResults.push(
            Object.freeze({
              id: item.id,
              success: true as const,
              result: item.result as TResult,
            }),
          );
        } else {
          allResults.push(
            Object.freeze({
              id: item.id,
              success: false as const,
              error: Object.freeze({
                code: item.error?.code ?? -32603,
                message: item.error?.message ?? "JSON-RPC call failed.",
                ...(item.error?.data !== undefined ? { data: item.error.data } : {}),
              }),
            }),
          );
        }
      }
    }

    return Object.freeze(allResults);
  }

  /**
   * Executes a batch of JSON-RPC requests and unwraps the results directly.
   * If any individual call in the batch returns a JSON-RPC error, throws the first error.
   */
  async executeStrictBatch<TResult = unknown>(
    requests: readonly JsonRpcRequest[],
    options?: JsonRpcBatchExecutionOptions,
  ): Promise<readonly TResult[]> {
    const results = await this.executeBatch<TResult>(requests, options);
    const firstFailure = results.find((item) => !item.success);
    if (firstFailure !== undefined && !firstFailure.success) {
      throw rpcResponseInvalid(
        `JSON-RPC batch call (id: ${firstFailure.id}) failed: [${firstFailure.error.code}] ${firstFailure.error.message}`,
      );
    }
    return Object.freeze(results.map((item) => (item as { readonly result: TResult }).result));
  }

  /**
   * Executes a single JSON-RPC request over a randomly selected healthy RPC endpoint from the pool.
   */
  async call<TResult = unknown>(
    request: JsonRpcRequest,
    options?: { readonly signal?: AbortSignal },
  ): Promise<TResult> {
    const results = await this.executeStrictBatch<TResult>([request], {
      batchChunkSize: 1,
      maxConcurrency: 1,
      ...(options?.signal === undefined ? {} : { signal: options.signal }),
    });
    return results[0]!;
  }

  private async executeChunkWithFailover(
    requests: readonly NormalizedJsonRpcRequest[],
    signal: AbortSignal | undefined,
    deadline: number,
  ): Promise<readonly JsonRpcBatchResponseItem[]> {
    const snapshot = await this.healthySnapshotWithRefresh(signal);
    if (snapshot.length === 0) {
      throw archiveRpcUnavailable("No healthy RPC endpoint is available in the pool.");
    }

    const endpoints = snapshot.slice(0, this.maxRpcAttempts);
    let lastError: unknown = archiveRpcUnavailable("No RPC attempt was made.");

    for (const endpoint of endpoints) {
      if (isAborted(signal)) {
        throw lastError;
      }
      if (this.now() >= deadline) {
        throw archiveRpcUnavailable("Archive RPC total timeout was exceeded.");
      }

      const remainingMs = Math.max(1, deadline - this.now());
      const timeoutMs = Math.min(this.attemptTimeoutMs, remainingMs);

      try {
        const result = await this.transport.batchCall({
          endpointUrl: endpoint.url,
          requests,
          timeoutMs,
          ...(signal === undefined ? {} : { signal }),
        });
        this.pool.reportOutcome(endpoint.id, "success");
        return result;
      } catch (error: unknown) {
        this.pool.reportOutcome(endpoint.id, "failure");
        lastError = error;
        if (isAborted(signal) || !isRetryableFailure(error)) {
          throw error;
        }
      }
    }

    throw lastError;
  }

  private async healthySnapshotWithRefresh(signal?: AbortSignal): Promise<readonly RpcEndpoint[]> {
    const snapshot = this.pool.healthySnapshot(this.randomSource);
    if (snapshot.length > 0) {
      return snapshot;
    }
    if (this.pool.refreshIfNeeded !== undefined) {
      await this.pool.refreshIfNeeded(signal);
    }
    return this.pool.healthySnapshot(this.randomSource);
  }
}

function isRetryableFailure(error: unknown): boolean {
  if (isJsonRpcCallError(error)) {
    // Node-level batch errors (e.g. batch size too large, batch unsupported) are retryable across endpoints
    return true;
  }
  if (isEvmDataError(error)) {
    return error.retryable;
  }
  return error instanceof Error && error.name !== "AbortError";
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal !== undefined && signal.aborted;
}

function chunk<T>(values: readonly T[], size: number): readonly (readonly T[])[] {
  const result: (readonly T[])[] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function runBounded<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= items.length) {
        return;
      }
      await worker(items[current]!, current);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(runners);
}
