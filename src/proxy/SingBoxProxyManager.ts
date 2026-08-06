import type { NormalizedSingBoxProxyConfiguration } from "../domain/configuration";
import { EvmDataError } from "../domain/errors";
import type { ProxyLease } from "../providers/DataProviderAdapter";
import { SingBoxBinaryManager } from "./SingBoxBinaryManager";
import { SingBoxRuntime } from "./SingBoxRuntime";
import { parseSingBoxProxyUrls } from "./SingBoxUrlParser";

export interface ManagedProxyRoute {
  assertReady(): void;
  acquire(signal?: AbortSignal): Promise<ProxyLease>;
  report(lease: ProxyLease, outcome: "success" | "proxy_failure" | "neutral"): void;
}

export interface SingBoxProxyManagerOptions {
  readonly binaryManager?: SingBoxBinaryManager;
  readonly createRuntime?: (binaryPath: string) => SingBoxRuntime;
}

/** Presents the managed sing-box process as one ordinary loopback HTTP proxy. */
export class SingBoxProxyManager implements ManagedProxyRoute {
  private readonly binaryManager: SingBoxBinaryManager;
  private readonly createRuntime: (binaryPath: string) => SingBoxRuntime;
  private readonly routeId = "sing-box-loopback";
  private readonly nodes;
  private runtime: SingBoxRuntime | null = null;
  private localUrl: string | null = null;
  private initialization: Promise<void> | null = null;
  private closed = false;

  constructor(
    private readonly configuration: NormalizedSingBoxProxyConfiguration,
    options: SingBoxProxyManagerOptions = {},
  ) {
    this.nodes = parseSingBoxProxyUrls(configuration.urls);
    this.binaryManager = options.binaryManager ?? new SingBoxBinaryManager();
    this.createRuntime = options.createRuntime ?? ((binaryPath) => new SingBoxRuntime({
      binaryPath,
      nodes: this.nodes,
      startupTimeoutMs: configuration.singBox.startupTimeoutMs,
    }));
  }

  assertReady(): void {
    if (this.closed) {
      throw new EvmDataError({ code: "PROXY_ERROR", message: "The managed proxy route is closed.", retryable: false });
    }
    if (this.configuration.singBox.downloadMode === "eager" && this.localUrl === null) {
      throw new EvmDataError({ code: "PROXY_NOT_READY", message: "Initialize the eager managed proxy before issuing requests.", retryable: true });
    }
  }

  async initialize(signal?: AbortSignal): Promise<void> {
    if (this.closed) {
      throw new EvmDataError({ code: "PROXY_ERROR", message: "The managed proxy route is closed.", retryable: false });
    }
    if (this.localUrl !== null) return;
    this.initialization ??= this.initializeRoute(signal);
    try {
      await this.initialization;
    } finally {
      if (this.localUrl === null) this.initialization = null;
    }
  }

  async acquire(signal?: AbortSignal): Promise<ProxyLease> {
    this.assertReady();
    if (this.localUrl === null) await this.initialize(signal);
    if (this.localUrl === null || this.closed) {
      throw new EvmDataError({ code: "PROXY_ERROR", message: "The managed proxy route is unavailable.", retryable: true });
    }
    return Object.freeze({ id: this.routeId, url: this.localUrl });
  }

  report(lease: ProxyLease, outcome: "success" | "proxy_failure" | "neutral"): void {
    if (lease.id !== this.routeId || this.localUrl === null || lease.url !== this.localUrl) return;
    // sing-box selects its own upstream nodes. A request failure alone cannot
    // prove that the local process is unhealthy, so it has no pool cooldown.
    void outcome;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const runtime = this.runtime;
    this.runtime = null;
    this.localUrl = null;
    this.initialization = null;
    if (runtime !== null) await runtime.close();
  }

  private async initializeRoute(signal: AbortSignal | undefined): Promise<void> {
    const binaryPath = await this.binaryManager.resolve({
      version: this.configuration.singBox.version,
      ...(this.configuration.singBox.binaryPath === undefined ? {} : { binaryPath: this.configuration.singBox.binaryPath }),
      ...(this.configuration.singBox.cacheDir === undefined ? {} : { cacheDir: this.configuration.singBox.cacheDir }),
      ...(signal === undefined ? {} : { signal }),
    });
    if (this.closed) return;
    const runtime = this.createRuntime(binaryPath);
    this.runtime = runtime;
    try {
      this.localUrl = await runtime.start(signal);
    } catch (error: unknown) {
      this.runtime = null;
      this.localUrl = null;
      await runtime.close();
      throw error;
    }
  }
}
