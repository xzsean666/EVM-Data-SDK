import type { CredentialLease } from "../providers/DataProviderAdapter";
import type { Clock } from "./clock";
import { systemClock } from "./clock";

export const DEFAULT_CREDENTIAL_RATE_COOLDOWN_MS = 1_000;

export type CredentialPoolOutcome =
  | "success"
  | "authentication_failed"
  | "rate_limited"
  | "neutral"
  | "cancelled";

export interface CredentialPoolOptions {
  readonly providerConfigurationId?: string;
  readonly clock?: Clock;
  readonly rateCooldownMs?: number;
}

export interface CredentialState {
  readonly id: string;
  readonly leased: boolean;
  readonly disabled: boolean;
  readonly cooldownUntil: number | null;
  readonly failureCount: number;
}

interface CredentialEntry {
  readonly lease: CredentialLease;
  readonly id: string;
  readonly value: string;
  leased: boolean;
  activeToken: number | null;
  nextToken: number;
  disabled: boolean;
  cooldownUntil: number | null;
  failureCount: number;
}

export class CredentialPool {
  private readonly entries: CredentialEntry[];
  private readonly clock: Clock;
  private readonly rateCooldownMs: number;
  private nextIndex = 0;

  constructor(
    credentials: readonly string[] | readonly CredentialLease[],
    options: CredentialPoolOptions = {},
  ) {
    this.clock = options.clock ?? systemClock;
    this.rateCooldownMs = validateCooldown(options.rateCooldownMs ?? DEFAULT_CREDENTIAL_RATE_COOLDOWN_MS);
    const prefix = options.providerConfigurationId ?? "credential";
    const ids = new Set<string>();
    this.entries = credentials.map((credential, index) => {
      const lease = typeof credential === "string"
        ? { id: `${prefix}-key-${index + 1}`, value: credential }
        : { id: credential.id, value: credential.value };
      if (lease.id.trim().length === 0 || lease.value.length === 0) {
        throw new Error("Credential IDs and values must not be empty.");
      }
      if (ids.has(lease.id)) {
        throw new Error(`Duplicate credential ID ${lease.id}.`);
      }
      ids.add(lease.id);
      return {
        lease: Object.freeze(lease),
        id: lease.id,
        value: lease.value,
        leased: false,
        activeToken: null,
        nextToken: 0,
        disabled: false,
        cooldownUntil: null,
        failureCount: 0,
      };
    });
  }

  acquire(now = this.clock.now()): CredentialLease | null {
    if (this.entries.length === 0) {
      return null;
    }
    for (let offset = 0; offset < this.entries.length; offset += 1) {
      const index = (this.nextIndex + offset) % this.entries.length;
      const entry = this.entries[index];
      if (entry === undefined || !isUsable(entry, now)) {
        continue;
      }
      entry.leased = true;
      entry.nextToken += 1;
      entry.activeToken = entry.nextToken;
      this.nextIndex = (index + 1) % this.entries.length;
      return Object.freeze({ id: entry.id, value: entry.value, leaseToken: entry.activeToken });
    }
    return null;
  }

  report(
    lease: CredentialLease,
    outcome: CredentialPoolOutcome,
    now = this.clock.now(),
    cooldownMs = this.rateCooldownMs,
  ): void {
    const entry = this.entries.find((candidate) => candidate.id === lease.id);
    if (entry === undefined || entry.value !== lease.value || lease.leaseToken !== undefined && lease.leaseToken !== entry.activeToken) {
      return;
    }
    entry.leased = false;
    entry.activeToken = null;
    if (outcome === "authentication_failed") {
      entry.disabled = true;
      entry.cooldownUntil = null;
      return;
    }
    if (outcome === "rate_limited") {
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
    // Provider-level failures do not penalize a credential without credential evidence.
  }

  hasAvailable(now = this.clock.now()): boolean {
    return this.entries.some((entry) => isUsable(entry, now));
  }

  isExhausted(now = this.clock.now()): boolean {
    return this.entries.length > 0 && this.entries.every((entry) => entry.disabled || entry.cooldownUntil !== null && entry.cooldownUntil > now);
  }

  nextAvailableAt(now = this.clock.now()): number | null {
    const values = this.entries
      .filter((entry) => !entry.disabled && !entry.leased && entry.cooldownUntil !== null && entry.cooldownUntil > now)
      .map((entry) => entry.cooldownUntil as number);
    return values.length === 0 ? null : Math.min(...values);
  }

  state(id: string): CredentialState | null {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (entry === undefined) {
      return null;
    }
    return Object.freeze({
      id: entry.id,
      leased: entry.leased,
      disabled: entry.disabled,
      cooldownUntil: entry.cooldownUntil,
      failureCount: entry.failureCount,
    });
  }
}

function isUsable(entry: CredentialEntry, now: number): boolean {
  return !entry.leased && !entry.disabled && (entry.cooldownUntil === null || entry.cooldownUntil <= now);
}

function validateCooldown(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 86_400_000) {
    throw new Error("Credential cooldown must be a non-negative bounded integer.");
  }
  return value;
}
