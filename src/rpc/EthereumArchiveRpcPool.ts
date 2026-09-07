import type { Clock, RandomSource } from "../execution/clock";
import { systemClock } from "../execution/clock";
import { CooldownTracker } from "../execution/CooldownTracker";
import { ArchiveRpcTransport, type ArchiveRpcCallOptions } from "./ArchiveRpcTransport";
import {
  MULTICALL3_ADDRESS,
  MULTICALL3_GET_BLOCK_NUMBER_SELECTOR,
  decodeGetBlockNumberResult,
} from "./EthereumMulticall3Codec";
import { shuffle } from "./RandomSource";

/**
 * Owns Ethereum Archive RPC endpoint initialization probes, passive health
 * tracking, stepped backoff cooldowns, and random healthy-endpoint snapshots
 * (ADR-028/ADR-029). Health changes through an explicit `initialize()` call
 * or `reportOutcome()` calls made by executors after real requests.
 */

export interface EthereumArchiveRpcEndpoint {
  readonly id: string;
  readonly url: string;
  readonly envKeyName?: string;
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
  readonly clock?: Clock;
  readonly onCooldownChange?: (event: {
    readonly id: string;
    readonly envKeyName?: string | undefined;
    readonly category: "rpc";
    readonly state: {
      readonly consecutiveFailures: number;
      readonly currentCooldownMs: number;
      readonly cooldownUntil: number | null;
      readonly firstFailureAt: number | null;
    };
  }) => void;
}

export type ArchiveRpcOutcome = "success" | "failure";

export interface EndpointCooldownState {
  readonly id: string;
  readonly envKeyName?: string;
  readonly isMaxCooldown: boolean;
  readonly isCoolingDown: boolean;
  readonly currentCooldownMs: number;
  readonly totalCooldownDurationMs: number;
  readonly consecutiveFailures: number;
  readonly cooldownUntil: number | null;
}

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
  private readonly clock: Clock;
  private readonly healthy = new Map<string, boolean>();
  private readonly trackers = new Map<string, CooldownTracker>();
  private readonly onCooldownChange?: EthereumArchiveRpcPoolOptions["onCooldownChange"];
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
    this.clock = options.clock ?? systemClock;
    this.onCooldownChange = options.onCooldownChange;
    for (const endpoint of this.endpoints) {
      this.healthy.set(endpoint.id, false);
      this.trackers.set(endpoint.id, new CooldownTracker({ clock: this.clock }));
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
    this.lastHealthRefreshAt = this.clock.now();
    await runBounded(this.endpoints, this.maxConcurrentProbes, async (endpoint) => {
      const healthy = await this.probeEndpoint(endpoint, signal);
      this.healthy.set(endpoint.id, healthy);
    });
  }

  /** Re-probe an empty pool after a transient startup/provider failure. */
  async refreshIfNeeded(signal?: AbortSignal): Promise<void> {
    if ([...this.endpoints].some((endpoint) => this.isHealthy(endpoint.id))) return;
    const now = this.clock.now();
    if (this.healthRefreshPromise !== undefined) return this.healthRefreshPromise;
    if (now - this.lastHealthRefreshAt < this.healthRefreshCooldownMs) return;
    this.healthRefreshPromise = this.initialize(signal).finally(() => {
      this.healthRefreshPromise = undefined;
    });
    return this.healthRefreshPromise;
  }

  /**
   * Restores persisted cooldown state (e.g. from SQLite).
   */
  restoreCooldownState(id: string, state: {
    readonly consecutiveFailures: number;
    readonly currentCooldownMs: number;
    readonly cooldownUntil: number | null;
    readonly firstFailureAt: number | null;
  }): boolean {
    const tracker = this.trackers.get(id);
    if (tracker === undefined) {
      return false;
    }
    tracker.restoreState(state);
    return true;
  }

  /**
   * Records the outcome of a real (non-probe) request against `id`.
   * When failure is reported, the endpoint enters stepped backoff cooldown.
   * When success is reported, cooldown and failure history are cleared.
   */
  reportOutcome(id: string, outcome: ArchiveRpcOutcome, now = this.clock.now()): void {
    const tracker = this.trackers.get(id);
    if (tracker === undefined || !this.healthy.has(id)) {
      return;
    }
    if (outcome === "success") {
      tracker.recordSuccess();
      this.healthy.set(id, true);
    } else {
      tracker.recordFailure(now);
    }
    const endpoint = this.endpoints.find((candidate) => candidate.id === id);
    this.onCooldownChange?.({
      id,
      envKeyName: endpoint?.envKeyName,
      category: "rpc",
      state: tracker.getState(now),
    });
  }

  isHealthy(id: string, now = this.clock.now()): boolean {
    const probeHealthy = this.healthy.get(id) ?? false;
    if (!probeHealthy) {
      return false;
    }
    const tracker = this.trackers.get(id);
    if (tracker !== undefined && tracker.isCoolingDown(now)) {
      return false;
    }
    return true;
  }

  /**
   * Snapshots currently healthy endpoints (not cooling down) and returns them
   * in an unbiased random permutation (upgrade doc 5.4 steps 1-2).
   */
  healthySnapshot(randomSource: RandomSource, now = this.clock.now()): readonly EthereumArchiveRpcEndpoint[] {
    const candidates = this.endpoints.filter((endpoint) => this.isHealthy(endpoint.id, now));
    return Object.freeze(shuffle(candidates, randomSource));
  }

  getEndpointCooldownState(id: string, now = this.clock.now()): EndpointCooldownState | null {
    const endpoint = this.endpoints.find((candidate) => candidate.id === id);
    const tracker = this.trackers.get(id);
    if (endpoint === undefined || tracker === undefined) {
      return null;
    }
    const state = tracker.getState(now);
    return Object.freeze({
      id: endpoint.id,
      ...(endpoint.envKeyName !== undefined ? { envKeyName: endpoint.envKeyName } : {}),
      isMaxCooldown: state.isMaxCooldown,
      isCoolingDown: state.isCoolingDown,
      currentCooldownMs: state.currentCooldownMs,
      totalCooldownDurationMs: state.totalCooldownDurationMs,
      consecutiveFailures: state.consecutiveFailures,
      cooldownUntil: state.cooldownUntil,
    });
  }

  getAllCooldownStates(now = this.clock.now()): readonly EndpointCooldownState[] {
    return Object.freeze(
      this.endpoints.map((endpoint) => this.getEndpointCooldownState(endpoint.id, now)!),
    );
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
