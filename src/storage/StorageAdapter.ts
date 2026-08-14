import type { NormalizedStorageConfiguration } from "../domain/configuration";

export interface StorageTransaction {
  exec(sql: string): void | Promise<void>;
  get<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown> | unknown[]): T | undefined | Promise<T | undefined>;
  all<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown> | unknown[]): T[] | Promise<T[]>;
  run(sql: string, params?: Record<string, unknown> | unknown[]): { changes: number; lastInsertRowid?: bigint | number } | Promise<{ changes: number; lastInsertRowid?: bigint | number }>;
}

export interface StorageAdapter extends StorageTransaction {
  readonly driver: "sqlite" | "postgres";
  initialize(): Promise<void>;
  close(): Promise<void>;
  transaction<T>(fn: (tx: StorageTransaction) => T | Promise<T>): Promise<T>;
}

export function createStorageAdapter(configuration: NormalizedStorageConfiguration): StorageAdapter {
  return configuration.driver === "sqlite" ? new SqliteStorageAdapter(configuration.path ?? ":memory:", configuration.busyTimeoutMs) : new PostgresStorageAdapter(configuration.url);
}

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { storageError } from "../domain/errors";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sdk_schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sdk_sync_scopes(scope_key TEXT PRIMARY KEY, chain_id INTEGER NOT NULL, address TEXT NOT NULL, dataset TEXT NOT NULL, next_block TEXT NOT NULL, target_block TEXT, last_complete_block TEXT, status TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sdk_sync_runs(run_id TEXT PRIMARY KEY, scope_key TEXT NOT NULL, requested_from TEXT NOT NULL, requested_to TEXT NOT NULL, covered_from TEXT, covered_to TEXT, status TEXT NOT NULL, records_seen INTEGER NOT NULL, records_written INTEGER NOT NULL, duplicates INTEGER NOT NULL, provider TEXT, error_code TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sdk_sync_windows(scope_key TEXT NOT NULL, start_block TEXT NOT NULL, end_block TEXT NOT NULL, run_id TEXT NOT NULL, committed_at TEXT NOT NULL, PRIMARY KEY(scope_key,start_block,end_block));
CREATE TABLE IF NOT EXISTS sdk_erc20_transfers(identity TEXT PRIMARY KEY, chain_id INTEGER NOT NULL, address TEXT NOT NULL, token_address TEXT NOT NULL, tx_hash TEXT NOT NULL, transaction_index TEXT, log_index TEXT, block_number TEXT NOT NULL, timestamp TEXT, token_name TEXT, token_symbol TEXT, token_decimals INTEGER, from_address TEXT NOT NULL, to_address TEXT NOT NULL, amount TEXT NOT NULL, provider TEXT NOT NULL, ingestion_source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sdk_transactions(identity TEXT PRIMARY KEY, chain_id INTEGER NOT NULL, address TEXT NOT NULL, tx_hash TEXT NOT NULL, block_number TEXT NOT NULL, payload TEXT NOT NULL, provider TEXT NOT NULL, ingestion_source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sdk_internal_native_transfers(identity TEXT PRIMARY KEY, chain_id INTEGER NOT NULL, address TEXT NOT NULL, tx_hash TEXT NOT NULL, trace_id TEXT, block_number TEXT NOT NULL, payload TEXT NOT NULL, provider TEXT NOT NULL, ingestion_source TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sdk_replay_jobs(job_id TEXT PRIMARY KEY, chain_id INTEGER NOT NULL, address TEXT NOT NULL, from_block TEXT NOT NULL, to_block TEXT, status TEXT NOT NULL, facts_revision TEXT NOT NULL, updated_at TEXT NOT NULL, processed_events INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_until TEXT, heartbeat_at TEXT, attempts INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sdk_user_state_snapshots(chain_id INTEGER NOT NULL,address TEXT NOT NULL,revision TEXT NOT NULL,block_number TEXT NOT NULL,payload TEXT NOT NULL,complete INTEGER NOT NULL,PRIMARY KEY(chain_id,address,revision,block_number));
CREATE TABLE IF NOT EXISTS sdk_replay_current(chain_id INTEGER NOT NULL,address TEXT NOT NULL,revision TEXT NOT NULL,as_of_block TEXT,PRIMARY KEY(chain_id,address));
CREATE TABLE IF NOT EXISTS sdk_price_sync_scopes(scope_key TEXT PRIMARY KEY,next_from TEXT NOT NULL,target_to TEXT,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sdk_price_points(scope_key TEXT NOT NULL,timestamp TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(scope_key,timestamp));
CREATE INDEX IF NOT EXISTS sdk_erc20_transfers_scope_block ON sdk_erc20_transfers(chain_id,address,block_number);
CREATE INDEX IF NOT EXISTS sdk_transactions_scope_block ON sdk_transactions(chain_id,address,block_number);
CREATE INDEX IF NOT EXISTS sdk_internal_scope_block ON sdk_internal_native_transfers(chain_id,address,block_number);
CREATE INDEX IF NOT EXISTS sdk_price_points_scope_time ON sdk_price_points(scope_key,timestamp);
`;

export class SqliteStorageAdapter implements StorageAdapter {
  readonly driver = "sqlite" as const;
  private db: any = null;
  constructor(private readonly path: string, private readonly busyTimeoutMs = 5000) {}
  async initialize(): Promise<void> {
    if (this.db !== null) return;
    if (this.path !== ":memory:") mkdirSync(dirname(resolve(this.path)), { recursive: true });
    try {
      const sqliteModuleName = "node:" + "sqlite";
      const sqlite = await import(sqliteModuleName);
      this.db = new sqlite.DatabaseSync(this.path);
      this.db.exec(`PRAGMA busy_timeout=${Math.max(0, Math.trunc(this.busyTimeoutMs))}; PRAGMA foreign_keys=ON;`);
      this.db.exec(SCHEMA);
      try { this.db.exec("ALTER TABLE sdk_replay_jobs ADD COLUMN processed_events INTEGER NOT NULL DEFAULT 0"); } catch { /* already present */ }
      for (const statement of [
        "ALTER TABLE sdk_replay_jobs ADD COLUMN lease_owner TEXT",
        "ALTER TABLE sdk_replay_jobs ADD COLUMN lease_until TEXT",
        "ALTER TABLE sdk_replay_jobs ADD COLUMN heartbeat_at TEXT",
        "ALTER TABLE sdk_replay_jobs ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0",
      ]) { try { this.db.exec(statement); } catch { /* already present */ } }
      this.db.prepare("INSERT OR IGNORE INTO sdk_schema_migrations(version, applied_at) VALUES(?, ?)").run(1, new Date().toISOString());
      this.db.prepare("INSERT OR IGNORE INTO sdk_schema_migrations(version, applied_at) VALUES(?, ?)").run(2, new Date().toISOString());
      this.db.prepare("INSERT OR IGNORE INTO sdk_schema_migrations(version, applied_at) VALUES(?, ?)").run(3, new Date().toISOString());
    } catch (error) {
      this.db = null;
      throw storageError("STORAGE_MIGRATION_FAILED", "SQLite storage initialization failed.", error);
    }
  }
  private ready(): any { if (this.db === null) throw storageError("STORAGE_NOT_INITIALIZED", "Storage is not initialized."); return this.db; }
  exec(sql: string): void { this.ready().exec(sql); }
  run(sql: string, params?: Record<string, unknown> | unknown[]): { changes: number; lastInsertRowid?: bigint | number } {
    const statement = this.ready().prepare(sql); const result = params === undefined ? statement.run() : Array.isArray(params) ? statement.run(...params as any[]) : statement.run(params as any);
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  }
  get<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown> | unknown[]): T | undefined {
    const statement = this.ready().prepare(sql); return (params === undefined ? statement.get() : Array.isArray(params) ? statement.get(...params as any[]) : statement.get(params as any)) as T | undefined;
  }
  all<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown> | unknown[]): T[] {
    const statement = this.ready().prepare(sql); return (params === undefined ? statement.all() : Array.isArray(params) ? statement.all(...params as any[]) : statement.all(params as any)) as T[];
  }
  async transaction<T>(fn: (tx: StorageTransaction) => T | Promise<T>): Promise<T> { const db = this.ready(); db.exec("BEGIN IMMEDIATE"); try { const result = await fn(this); db.exec("COMMIT"); return result; } catch (error) { try { db.exec("ROLLBACK"); } catch {} throw error; } }
  async close(): Promise<void> { this.db?.close(); this.db = null; }
}

export class PostgresStorageAdapter implements StorageAdapter {
  readonly driver = "postgres" as const;
  private pool: any = null;
  private readonly transactionContext = new AsyncLocalStorage<any>();
  constructor(private readonly url: string) {}
  async initialize(): Promise<void> {
    if (this.pool !== null) return;
    try {
      const pg = await import("pg");
      this.pool = new pg.Pool({ connectionString: this.url, max: 10, application_name: "evm-data-sdk" });
      await this.pool.query("SELECT 1");
      await this.pool.query(POSTGRES_SCHEMA);
      for (const statement of [
        "ALTER TABLE sdk_replay_jobs ADD COLUMN IF NOT EXISTS processed_events INTEGER NOT NULL DEFAULT 0",
        "ALTER TABLE sdk_replay_jobs ADD COLUMN IF NOT EXISTS lease_owner TEXT",
        "ALTER TABLE sdk_replay_jobs ADD COLUMN IF NOT EXISTS lease_until TEXT",
        "ALTER TABLE sdk_replay_jobs ADD COLUMN IF NOT EXISTS heartbeat_at TEXT",
        "ALTER TABLE sdk_replay_jobs ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0",
      ]) await this.pool.query(statement);
      await this.pool.query("INSERT INTO sdk_schema_migrations(version,applied_at) VALUES($1,$2) ON CONFLICT(version) DO NOTHING", [1, new Date().toISOString()]);
      await this.pool.query("INSERT INTO sdk_schema_migrations(version,applied_at) VALUES($1,$2) ON CONFLICT(version) DO NOTHING", [2, new Date().toISOString()]);
      await this.pool.query("INSERT INTO sdk_schema_migrations(version,applied_at) VALUES($1,$2) ON CONFLICT(version) DO NOTHING", [3, new Date().toISOString()]);
    } catch (error) { await this.pool?.end().catch(() => undefined); this.pool = null; throw storageError("STORAGE_MIGRATION_FAILED", "PostgreSQL storage initialization failed.", error); }
  }
  private ready(): any { if (this.pool === null) throw storageError("STORAGE_NOT_INITIALIZED", "Storage is not initialized."); return this.pool; }
  private connection(): any { return this.transactionContext.getStore() ?? this.ready(); }
  async exec(sql: string): Promise<void> { await this.connection().query(normalizePostgresSql(sql).text); }
  async run(sql: string, params?: Record<string, unknown> | unknown[]): Promise<{ changes: number; lastInsertRowid?: bigint | number }> { const result = await this.connection().query(...queryArgs(sql, params)); return { changes: result.rowCount ?? 0 }; }
  async get<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown> | unknown[]): Promise<T | undefined> { const result = await this.connection().query(...queryArgs(sql, params)); return result.rows[0] as T | undefined; }
  async all<T = Record<string, unknown>>(sql: string, params?: Record<string, unknown> | unknown[]): Promise<T[]> { const result = await this.connection().query(...queryArgs(sql, params)); return result.rows as T[]; }
  async transaction<T>(fn: (tx: StorageTransaction) => T | Promise<T>): Promise<T> {
    const client = await this.ready().connect(); const tx: StorageTransaction = { exec: async (sql) => { await client.query(normalizePostgresSql(sql).text); }, run: async (sql, params) => { const result = await client.query(...queryArgs(sql, params)); return { changes: result.rowCount ?? 0 }; }, get: async (sql, params) => { const result = await client.query(...queryArgs(sql, params)); return result.rows[0] as any; }, all: async (sql, params) => { const result = await client.query(...queryArgs(sql, params)); return result.rows as any[]; } };
    try { await client.query("BEGIN"); const result = await this.transactionContext.run(client, () => fn(tx)); await client.query("COMMIT"); return result; } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; } finally { client.release(); }
  }
  async close(): Promise<void> { await this.pool?.end(); this.pool = null; }
}

const POSTGRES_SCHEMA = SCHEMA.replace(/CREATE TABLE IF NOT EXISTS ([^;]+);/g, (_whole, definition: string) => `CREATE TABLE IF NOT EXISTS ${definition.replace(/INTEGER PRIMARY KEY/g, "BIGINT PRIMARY KEY").replace(/ INTEGER /g, " BIGINT ")};`).replace(/INSERT OR (REPLACE|IGNORE)/g, "INSERT");
export function normalizePostgresSql(sql: string): { text: string } { const ignored = /^\s*INSERT OR IGNORE INTO/i.test(sql); const semicolon = /;\s*$/.test(sql); const source = sql.replace(/;\s*$/, ""); let text = source.replace(/CAST\(([^)]+) AS INTEGER\)/gi, "CAST($1 AS NUMERIC)"); text = text.replace(/INSERT OR IGNORE INTO/gi, "INSERT INTO"); const replace = /^\s*INSERT OR REPLACE INTO\s+([\w_]+)\s*\(([^)]*)\)\s*VALUES\s*/i.exec(source); if (replace) { const columns = replace[2]!.split(",").map((column) => column.trim()); const base = source.replace(/^\s*INSERT OR REPLACE INTO/i, "INSERT INTO"); text = base + " ON CONFLICT DO UPDATE SET " + columns.map((column) => `${column}=EXCLUDED.${column}`).join(","); } text = text.replace(/\?/g, (_, offset: number) => `$${countQuestionMarks(source.slice(0, offset)) + 1}`); if (ignored && !/ON CONFLICT/i.test(text)) text += " ON CONFLICT DO NOTHING"; return { text: semicolon ? `${text};` : text }; }
function countQuestionMarks(value: string): number { return (value.match(/\?/g) ?? []).length; }
function queryArgs(sql: string, params?: Record<string, unknown> | unknown[]): [string, unknown[]?] { const normalized = normalizePostgresSql(sql); return params === undefined ? [normalized.text] : [normalized.text, Array.isArray(params) ? params : Object.values(params)]; }
