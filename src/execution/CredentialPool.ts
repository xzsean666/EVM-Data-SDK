import type { CredentialLease } from "../providers/DataProviderAdapter";
import type { Clock } from "./clock";
import { systemClock } from "./clock";
import { CooldownTracker } from "./CooldownTracker";

export const DEFAULT_CREDENTIAL_RATE_COOLDOWN_MS = 60_000;

export type CredentialPoolOutcome =
  | "success"
  | "authentication_failed"
  | "rate_limited"
  | "neutral"
  | "cancelled";

export interface CredentialPoolOptions {
  readonly providerConfigurationId?: string | undefined;
  readonly clock?: Clock | undefined;
  readonly rateCooldownMs?: number | undefined;
  readonly envKeyNames?: readonly string[] | undefined;
  readonly cooldownTiersMs?: readonly number[] | undefined;
}

export interface CredentialState {
  readonly id: string;
  readonly envKeyName?: string | undefined;
  readonly leased: boolean;
  readonly disabled: boolean;
  readonly cooldownUntil: number | null;
  readonly failureCount: number;
  readonly isMaxCooldown?: boolean | undefined;
  readonly isCoolingDown?: boolean | undefined;
  readonly currentCooldownMs?: number | undefined;
  readonly totalCooldownDurationMs?: number | undefined;
}

export interface CredentialCooldownState {
  readonly id: string;
  readonly envKeyName?: string | undefined;
  readonly isMaxCooldown: boolean;
  readonly isCoolingDown: boolean;
  readonly currentCooldownMs: number;
  readonly totalCooldownDurationMs: number;
  readonly consecutiveFailures: number;
  readonly cooldownUntil: number | null;
  readonly disabled: boolean;
  readonly leased: boolean;
}

interface CredentialEntry {
  readonly lease: CredentialLease;
  readonly id: string;
  readonly value: string;
  readonly envKeyName?: string | undefined;
  readonly tracker: CooldownTracker;
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
  private readonly rateCooldownMs?: number | undefined;
  private nextIndex = 0;

  constructor(
    credentials: readonly string[] | readonly CredentialLease[],
    options: CredentialPoolOptions = {},
  ) {
    this.clock = options.clock ?? systemClock;
    this.rateCooldownMs = options.rateCooldownMs !== undefined
      ? validateCooldown(options.rateCooldownMs)
      : undefined;
    const prefix = options.providerConfigurationId ?? "credential";
    const ids = new Set<string>();
    const customTiers = options.cooldownTiersMs ?? (
      options.rateCooldownMs !== undefined
        ? [options.rateCooldownMs, options.rateCooldownMs * 5, options.rateCooldownMs * 15]
        : undefined
    );

    this.entries = credentials.map((credential, index) => {
      const lease = typeof credential === "string"
        ? {
            id: `${prefix}-key-${index + 1}`,
            value: credential,
            ...(options.envKeyNames?.[index] !== undefined ? { envKeyName: options.envKeyNames[index] } : {}),
          }
        : {
            id: credential.id,
            value: credential.value,
            ...((credential.envKeyName ?? options.envKeyNames?.[index]) !== undefined
              ? { envKeyName: credential.envKeyName ?? options.envKeyNames?.[index] }
              : {}),
          };
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
        envKeyName: lease.envKeyName,
        tracker: new CooldownTracker({
          clock: this.clock,
          ...(customTiers !== undefined ? { cooldownTiersMs: customTiers } : {}),
        }),
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
      return Object.freeze({
        id: entry.id,
        value: entry.value,
        leaseToken: entry.activeToken,
        ...(entry.envKeyName !== undefined ? { envKeyName: entry.envKeyName } : {}),
      });
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
    if (entry === undefined || entry.value !== lease.value || (lease.leaseToken !== undefined && lease.leaseToken !== entry.activeToken)) {
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
      entry.tracker.recordFailure(now);
      const trackerState = entry.tracker.getState(now);
      const effectiveCooldown = cooldownMs !== undefined
        ? validateCooldown(cooldownMs)
        : trackerState.currentCooldownMs;
      entry.cooldownUntil = now + effectiveCooldown;
      entry.failureCount += 1;
      return;
    }
    if (outcome === "success") {
      entry.tracker.recordSuccess();
      entry.failureCount = 0;
      entry.cooldownUntil = null;
      return;
    }
    if (outcome === "cancelled") {
      entry.failureCount = Math.max(0, entry.failureCount - 1);
      if (entry.cooldownUntil !== null && entry.cooldownUntil <= now) {
        entry.cooldownUntil = null;
      }
      return;
    }
  }

  hasAvailable(now = this.clock.now()): boolean {
    return this.entries.some((entry) => isUsable(entry, now));
  }

  isExhausted(now = this.clock.now()): boolean {
    return (
      this.entries.length > 0 &&
      this.entries.every(
        (entry) =>
          entry.disabled ||
          entry.tracker.isCoolingDown(now) ||
          (entry.cooldownUntil !== null && entry.cooldownUntil > now),
      )
    );
  }

  nextAvailableAt(now = this.clock.now()): number | null {
    const values = this.entries
      .filter(
        (entry) =>
          !entry.disabled &&
          !entry.leased &&
          ((entry.cooldownUntil !== null && entry.cooldownUntil > now) ||
            entry.tracker.isCoolingDown(now)),
      )
      .map((entry) => {
        const trackerUntil = entry.tracker.getState(now).cooldownUntil;
        if (entry.cooldownUntil !== null && trackerUntil !== null) {
          return Math.min(entry.cooldownUntil, trackerUntil);
        }
        return (entry.cooldownUntil ?? trackerUntil) as number;
      });
    return values.length === 0 ? null : Math.min(...values);
  }

  state(id: string, now = this.clock.now()): CredentialState | null {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (entry === undefined) {
      return null;
    }
    const trackerState = entry.tracker.getState(now);
    return Object.freeze({
      id: entry.id,
      ...(entry.envKeyName !== undefined ? { envKeyName: entry.envKeyName } : {}),
      leased: entry.leased,
      disabled: entry.disabled,
      cooldownUntil: entry.cooldownUntil,
      failureCount: entry.failureCount,
      isMaxCooldown: trackerState.isMaxCooldown,
      isCoolingDown: trackerState.isCoolingDown,
      currentCooldownMs: trackerState.currentCooldownMs,
      totalCooldownDurationMs: trackerState.totalCooldownDurationMs,
    });
  }

  getCooldownState(id: string, now = this.clock.now()): CredentialCooldownState | null {
    const entry = this.entries.find((candidate) => candidate.id === id);
    if (entry === undefined) {
      return null;
    }
    const trackerState = entry.tracker.getState(now);
    return Object.freeze({
      id: entry.id,
      ...(entry.envKeyName !== undefined ? { envKeyName: entry.envKeyName } : {}),
      isMaxCooldown: trackerState.isMaxCooldown,
      isCoolingDown: trackerState.isCoolingDown,
      currentCooldownMs: trackerState.currentCooldownMs,
      totalCooldownDurationMs: trackerState.totalCooldownDurationMs,
      consecutiveFailures: trackerState.consecutiveFailures,
      cooldownUntil: trackerState.cooldownUntil,
      disabled: entry.disabled,
      leased: entry.leased,
    });
  }

  getAllCooldownStates(now = this.clock.now()): readonly CredentialCooldownState[] {
    return Object.freeze(
      this.entries.map((entry) => this.getCooldownState(entry.id, now)!),
    );
  }

  getMaxCooldownCredentials(now = this.clock.now()): readonly CredentialCooldownState[] {
    return Object.freeze(
      this.getAllCooldownStates(now).filter((s) => s.isMaxCooldown),
    );
  }
}

function isUsable(entry: CredentialEntry, now: number): boolean {
  return !entry.leased && !entry.disabled && !entry.tracker.isCoolingDown(now) && (entry.cooldownUntil === null || entry.cooldownUntil <= now);
}

function validateCooldown(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 86_400_000) {
    throw new Error("Credential cooldown must be a non-negative bounded integer.");
  }
  return value;
}
