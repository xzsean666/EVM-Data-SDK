import type { ProxyConfiguration } from "../domain/configuration";
import type { ProxyLease } from "../providers/DataProviderAdapter";
import type { Clock } from "./clock";
import { systemClock } from "./clock";

export const DEFAULT_PROXY_COOLDOWN_MS = 1_000;

export type ProxyPoolOutcome = "success" | "proxy_failure" | "neutral" | "cancelled";

export interface ProxyPoolOptions {
  readonly allowDirect?: boolean;
  readonly clock?: Clock;
  readonly cooldownMs?: number;
}

export interface ProxyState {
  readonly id: string;
  readonly leased: boolean;
  readonly cooldownUntil: number | null;
  readonly failureCount: number;
}

interface ProxyEntry {
  readonly lease: ProxyLease;
  readonly id: string;
  readonly url: string;
  leased: boolean;
  activeToken: number | null;
  nextToken: number;
  cooldownUntil: number | null;
  failureCount: number;
}

export class ProxyPool {
  private readonly entries: ProxyEntry[];
  private readonly allowDirect: boolean;
  private readonly clock: Clock;
  private readonly cooldownMs: number;
  private nextIndex = 0;

  constructor(
    proxies: readonly string[] | readonly ProxyConfiguration[] | readonly ProxyLease[],
    options: ProxyPoolOptions,
  ) {
    this.allowDirect = options.allowDirect ?? true;
    this.clock = options.clock ?? systemClock;
    this.cooldownMs = validateCooldown(options.cooldownMs ?? DEFAULT_PROXY_COOLDOWN_MS);
    const ids = new Set<string>();
    this.entries = proxies.map((proxy, index) => {
      const url = typeof proxy === "string" ? proxy : proxy.url;
      const id = typeof proxy === "string"
        ? `proxy-${index + 1}`
        : "id" in proxy && typeof proxy.id === "string" ? proxy.id : `proxy-${index + 1}`;
      validateProxyUrl(url);
      if (ids.has(id)) {
        throw new Error(`Duplicate proxy ID ${id}.`);
      }
      ids.add(id);
      return {
        lease: Object.freeze({ id, url }),
        id,
        url,
        leased: false,
        activeToken: null,
        nextToken: 0,
        cooldownUntil: null,
        failureCount: 0,
      };
    });
  }

  acquire(now = this.clock.now()): ProxyLease | null | undefined {
    const routeCount = this.entries.length + (this.allowDirect ? 1 : 0);
    for (let offset = 0; offset < routeCount; offset += 1) {
      const index = (this.nextIndex + offset) % routeCount;
      if (this.allowDirect && index === this.entries.length) {
        this.nextIndex = (index + 1) % routeCount;
        return null;
      }
      const entry = this.entries[index];
      if (entry !== undefined && isUsable(entry, now)) {
        entry.leased = true;
        entry.nextToken += 1;
        entry.activeToken = entry.nextToken;
        this.nextIndex = (index + 1) % routeCount;
        return Object.freeze({ id: entry.id, url: entry.url, leaseToken: entry.activeToken });
      }
    }
    return undefined;
  }

  report(
    lease: ProxyLease,
    outcome: ProxyPoolOutcome,
    now = this.clock.now(),
    cooldownMs = this.cooldownMs,
  ): void {
    const entry = this.entries.find((candidate) => candidate.id === lease.id);
    if (entry === undefined || entry.url !== lease.url || lease.leaseToken !== undefined && lease.leaseToken !== entry.activeToken) {
      return;
    }
    entry.leased = false;
    entry.activeToken = null;
    if (outcome === "proxy_failure") {
      entry.cooldownUntil = now + validateCooldown(cooldownMs);
      entry.failureCount += 1;
      return;
    }
    if (outcome === "success" || outcome === "cancelled") {
      entry.failureCount = Math.max(0, entry.failureCount - 1);
      if (entry.cooldownUntil !== null && entry.cooldownUntil <= now) {
        entry.cooldownUntil = null;
      }
      return;
    }
    // Provider-level failures do not penalize a proxy without transport evidence.
  }

  hasAvailable(now = this.clock.now()): boolean {
    return this.allowDirect || this.entries.some((entry) => isUsable(entry, now));
  }

  isExhausted(now = this.clock.now()): boolean {
    return !this.allowDirect && this.entries.every((entry) => entry.cooldownUntil !== null && entry.cooldownUntil > now);
  }

  nextAvailableAt(now = this.clock.now()): number | null {
    const values = this.entries
      .filter((entry) => !entry.leased && entry.cooldownUntil !== null && entry.cooldownUntil > now)
      .map((entry) => entry.cooldownUntil as number);
    return values.length === 0 ? null : Math.min(...values);
  }

  state(id: string): ProxyState | null {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (entry === undefined) {
      return null;
    }
    return Object.freeze({
      id: entry.id,
      leased: entry.leased,
      cooldownUntil: entry.cooldownUntil,
      failureCount: entry.failureCount,
    });
  }
}

function isUsable(entry: ProxyEntry, now: number): boolean {
  return !entry.leased && (entry.cooldownUntil === null || entry.cooldownUntil <= now);
}

function validateProxyUrl(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Proxy URL must be valid.");
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.hostname.length === 0 ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("Proxy URL must use HTTP(S) without a path, query, or fragment.");
  }
  const port = parsed.port === "" ? (parsed.protocol === "https:" ? 443 : 80) : Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("Proxy URL contains an invalid port.");
  }
  try {
    if (parsed.username !== "") decodeURIComponent(parsed.username);
    if (parsed.password !== "") decodeURIComponent(parsed.password);
  } catch {
    throw new Error("Proxy credentials must use valid URL encoding.");
  }
}

function validateCooldown(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 86_400_000) {
    throw new Error("Proxy cooldown must be a non-negative bounded integer.");
  }
  return value;
}
