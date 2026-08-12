import type { RandomSource } from "../execution/clock";
import { ArchiveRpcTransport, type ArchiveRpcCallOptions } from "./ArchiveRpcTransport";
import {
  MULTICALL3_ADDRESS,
  MULTICALL3_GET_BLOCK_NUMBER_SELECTOR,
  decodeGetBlockNumberResult,
} from "./EthereumMulticall3Codec";
import { shuffle } from "./RandomSource";

/**
 * Owns Ethereum Archive RPC endpoint initialization probes, passive health
 * tracking, and random healthy-endpoint snapshots (ADR-028/ADR-029; upgrade
 * doc sections 5.3/5.4). Has no proxy, Chainlink ABI, or background-timer
 * knowledge: health changes only through an explicit `initialize()` call or
 * a `reportOutcome()` call made by `EthereumArchiveRpcExecutor` after a real
 * request. Every probe is direct-only through `ArchiveRpcTransport`.
 */

export interface EthereumArchiveRpcEndpoint {
  readonly id: string;
  readonly url: string;
}

export interface EthereumArchiveRpcPoolOptions {
  readonly endpoints: readonly EthereumArchiveRpcEndpoint[];
  readonly transport?: ArchiveRpcTransport;
  /** Canonical non-negative base-10 historical probe block. Defaults to 18,000,000. */
  readonly probeBlockNumber?: string;
  readonly healthCheckTimeoutMs?: number;
  readonly maxConcurrentProbes?: number;
  /** EIP-155 chain ID served by every endpoint. Defaults to Ethereum (1). */
  readonly expectedChainId?: number;
  /** Multicall3 deployment used by this chain. Defaults to the Ethereum deployment. */
  readonly multicall3Address?: string;
  readonly multicall3DeploymentBlock?: string;
  /** Minimum delay between automatic empty-pool health refreshes. */
  readonly healthRefreshCooldownMs?: number;
}

export type ArchiveRpcOutcome = "success" | "failure";

const DEFAULT_PROBE_BLOCK_NUMBER = "18000000";
const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_CONCURRENT_PROBES = 5;
const DEFAULT_HEALTH_REFRESH_COOLDOWN_MS = 5_000;

export class EthereumArchiveRpcPool {
  private readonly endpoints: readonly EthereumArchiveRpcEndpoint[];
  private readonly transport: ArchiveRpcTransport;
  private readonly probeBlockNumber: bigint;
  private readonly healthCheckTimeoutMs: number;
  private readonly maxConcurrentProbes: number;
  readonly expectedChainId: number;
  readonly multicall3Address: string;
  readonly multicall3DeploymentBlock: bigint;
  private readonly healthRefreshCooldownMs: number;
  private readonly healthy = new Map<string, boolean>();
  private lastHealthRefreshAt = 0;
  private healthRefreshPromise: Promise<void> | undefined;

  constructor(options: EthereumArchiveRpcPoolOptions) {
    const ids = new Set<string>();
    for (const endpoint of options.endpoints) {
      if (ids.has(endpoint.id)) {
        throw new Error(`Duplicate Archive RPC endpoint id ${endpoint.id}.`);
      }
      ids.add(endpoint.id);
    }
    this.endpoints = options.endpoints;
    this.transport = options.transport ?? new ArchiveRpcTransport();
    this.probeBlockNumber = BigInt(options.probeBlockNumber ?? DEFAULT_PROBE_BLOCK_NUMBER);
    this.healthCheckTimeoutMs = options.healthCheckTimeoutMs ?? DEFAULT_HEALTH_CHECK_TIMEOUT_MS;
    this.maxConcurrentProbes = Math.max(1, options.maxConcurrentProbes ?? DEFAULT_MAX_CONCURRENT_PROBES);
    this.expectedChainId = options.expectedChainId ?? 1;
    this.multicall3Address = options.multicall3Address ?? MULTICALL3_ADDRESS;
    this.multicall3DeploymentBlock = BigInt(options.multicall3DeploymentBlock ?? "14353601");
    this.healthRefreshCooldownMs = Math.max(0, options.healthRefreshCooldownMs ?? DEFAULT_HEALTH_REFRESH_COOLDOWN_MS);
    for (const endpoint of this.endpoints) {
      this.healthy.set(endpoint.id, false);
    }
  }

  /**
   * Probes every configured endpoint concurrently, bounded by
   * `maxConcurrentProbes`. Never throws for an individual endpoint's probe
   * failure — that endpoint is simply left/marked unhealthy. Callable again
   * later (for example from a caller-triggered `refreshArchiveRpcHealth()`);
   * there is no automatic interval.
   */
  async initialize(signal?: AbortSignal): Promise<void> {
    this.lastHealthRefreshAt = Date.now();
    await runBounded(this.endpoints, this.maxConcurrentProbes, async (endpoint) => {
      const healthy = await this.probeEndpoint(endpoint, signal);
      this.healthy.set(endpoint.id, healthy);
    });
  }

  /** Re-probe an empty pool after a transient startup/provider failure. */
  async refreshIfNeeded(signal?: AbortSignal): Promise<void> {
    if ([...this.healthy.values()].some(Boolean)) return;
    const now = Date.now();
    if (this.healthRefreshPromise !== undefined) return this.healthRefreshPromise;
    if (now - this.lastHealthRefreshAt < this.healthRefreshCooldownMs) return;
    this.healthRefreshPromise = this.initialize(signal).finally(() => {
      this.healthRefreshPromise = undefined;
    });
    return this.healthRefreshPromise;
  }

  /**
   * Records the outcome of a real (non-probe) request against `id`. Callers
   * report `"failure"` only for a retryable endpoint/network/archive-depth
   * failure — never for a Chainlink-level per-feed revert, which says
   * nothing about the endpoint's own health.
   */
  reportOutcome(id: string, outcome: ArchiveRpcOutcome): void {
    if (!this.healthy.has(id)) {
      return;
    }
    this.healthy.set(id, outcome === "success");
  }

  isHealthy(id: string): boolean {
    return this.healthy.get(id) ?? false;
  }

  /**
   * Snapshots currently healthy endpoints and returns them in an unbiased
   * random permutation (upgrade doc 5.4 steps 1-2). The caller pins the
   * whole operation to the first entry and only advances to the next entry
   * after a retryable failure; this method has no notion of "operation".
   */
  healthySnapshot(randomSource: RandomSource): readonly EthereumArchiveRpcEndpoint[] {
    const candidates = this.endpoints.filter((endpoint) => this.healthy.get(endpoint.id) === true);
    return Object.freeze(shuffle(candidates, randomSource));
  }

  private async probeEndpoint(endpoint: EthereumArchiveRpcEndpoint, signal?: AbortSignal): Promise<boolean> {
    try {
      const chainId = await this.callProbe(endpoint, "eth_chainId", [], signal);
      if (chainId !== `0x${this.expectedChainId.toString(16)}`) {
        return false;
      }

      const blockTag = `0x${this.probeBlockNumber.toString(16)}`;
      const block = await this.callProbe(endpoint, "eth_getBlockByNumber", [blockTag, false], signal);
      if (!isValidBlockHeader(block, blockTag)) {
        return false;
      }

      const callResult = await this.callProbe(
        endpoint,
        "eth_call",
        [{ to: this.multicall3Address, data: `0x${MULTICALL3_GET_BLOCK_NUMBER_SELECTOR}` }, blockTag],
        signal,
      );
      if (typeof callResult !== "string") {
        return false;
      }
      const observedBlockNumber = decodeGetBlockNumberResult(callResult);
      return observedBlockNumber === this.probeBlockNumber;
    } catch {
      return false;
    }
  }

  private async callProbe(
    endpoint: EthereumArchiveRpcEndpoint,
    method: string,
    params: readonly unknown[],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const options: ArchiveRpcCallOptions = {
      endpointUrl: endpoint.url,
      method,
      params,
      timeoutMs: this.healthCheckTimeoutMs,
      ...(signal === undefined ? {} : { signal }),
    };
    return this.transport.call(options);
  }
}

function isValidBlockHeader(value: unknown, expectedBlockTag: string): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const block = value as { hash?: unknown; number?: unknown; timestamp?: unknown };
  if (typeof block.hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(block.hash)) {
    return false;
  }
  if (typeof block.number !== "string" || !/^0x[0-9a-fA-F]+$/.test(block.number)) {
    return false;
  }
  if (BigInt(block.number) !== BigInt(expectedBlockTag)) {
    return false;
  }
  if (typeof block.timestamp !== "string" || !/^0x[0-9a-fA-F]+$/.test(block.timestamp)) {
    return false;
  }
  return true;
}

async function runBounded<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;
  async function next(): Promise<void> {
    for (;;) {
      const current = index;
      index += 1;
      if (current >= items.length) {
        return;
      }
      await worker(items[current]!);
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, () => next());
  await Promise.all(runners);
}
