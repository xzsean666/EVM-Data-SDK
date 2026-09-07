import type { StorageAdapter } from "./StorageAdapter";

export interface PersistedCooldownRecord {
  readonly resourceKey: string;
  readonly category: "rpc" | "data-api";
  readonly envKeyName?: string | undefined;
  readonly failureCount: number;
  readonly currentCooldownMs: number;
  readonly cooldownUntil: number | null;
  readonly firstFailureAt: number | null;
  readonly updatedAt: string;
}

export interface SaveCooldownParams {
  readonly resourceKey: string;
  readonly category: "rpc" | "data-api";
  readonly envKeyName?: string | undefined;
  readonly state: {
    readonly consecutiveFailures: number;
    readonly currentCooldownMs: number;
    readonly cooldownUntil: number | null;
    readonly firstFailureAt: number | null;
  };
  readonly now?: number | undefined;
}

export class CooldownStore {
  constructor(private readonly storage: StorageAdapter) {}

  async loadAll(): Promise<readonly PersistedCooldownRecord[]> {
    try {
      const rows = await this.storage.all<{
        resource_key: string;
        category: string;
        env_key_name: string | null;
        failure_count: number | string;
        current_cooldown_ms: number | string;
        cooldown_until: number | string | null;
        first_failure_at: number | string | null;
        updated_at: string;
      }>(
        "SELECT resource_key, category, env_key_name, failure_count, current_cooldown_ms, cooldown_until, first_failure_at, updated_at FROM sdk_cooldown_states",
      );
      return rows.map((row) => ({
        resourceKey: row.resource_key,
        category: row.category as "rpc" | "data-api",
        envKeyName: row.env_key_name ?? undefined,
        failureCount: Number(row.failure_count),
        currentCooldownMs: Number(row.current_cooldown_ms),
        cooldownUntil: row.cooldown_until !== null && row.cooldown_until !== undefined ? Number(row.cooldown_until) : null,
        firstFailureAt: row.first_failure_at !== null && row.first_failure_at !== undefined ? Number(row.first_failure_at) : null,
        updatedAt: row.updated_at,
      }));
    } catch {
      return [];
    }
  }

  save(params: SaveCooldownParams): void {
    const sql = `INSERT OR REPLACE INTO sdk_cooldown_states (
      resource_key, category, env_key_name, failure_count, current_cooldown_ms, cooldown_until, first_failure_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
    const values = [
      params.resourceKey,
      params.category,
      params.envKeyName ?? null,
      params.state.consecutiveFailures,
      params.state.currentCooldownMs,
      params.state.cooldownUntil,
      params.state.firstFailureAt,
      new Date(params.now ?? Date.now()).toISOString(),
    ];
    try {
      const res = this.storage.run(sql, values);
      if (res && typeof (res as Promise<unknown>).catch === "function") {
        (res as Promise<unknown>).catch(() => undefined);
      }
    } catch {
      // Storage might not be initialized yet; ignore safely
    }
  }

  delete(resourceKey: string): void {
    const sql = "DELETE FROM sdk_cooldown_states WHERE resource_key = ?";
    try {
      const res = this.storage.run(sql, [resourceKey]);
      if (res && typeof (res as Promise<unknown>).catch === "function") {
        (res as Promise<unknown>).catch(() => undefined);
      }
    } catch {
      // Storage might not be initialized yet; ignore safely
    }
  }
}
