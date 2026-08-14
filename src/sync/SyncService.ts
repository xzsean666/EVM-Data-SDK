import { createHash, randomUUID } from "node:crypto";
import type { StorageAdapter } from "../storage/StorageAdapter";
import type { ChainReference } from "../domain/chains";
import type { SyncDataset, DatasetUpdateRequest, DatasetUpdateResult, RecollectRequest, RecollectResult, SyncAuditRequest, SyncAuditResult, SyncStatus } from "../domain/syncModels";
import type { AddressService } from "../services/AddressService";
import type { TokenService } from "../services/TokenService";
import type { ApiChainService } from "../services/ApiChainService";
import { EvmDataError } from "../domain/errors";

interface SyncDeps {
  storage: StorageAdapter;
  address: AddressService;
  token: TokenService;
  chain: ApiChainService;
  resolveChain: (chain: ChainReference) => { chainId: number };
  maxWindowBlocks?: number;
  reorgOverlapBlocks?: number;
}
interface FetchedWindow { items: readonly any[]; start: string; end: string; provider: string; }

/** Durable, one-window-at-a-time synchronization service. Provider pagination never enters storage. */
export class SyncService {
  constructor(private readonly deps: SyncDeps) {}

  updateTokenTransfers(input: Omit<DatasetUpdateRequest, "dataset">) { return this.update({ ...input, dataset: "erc20" }); }
  updateTransactions(input: Omit<DatasetUpdateRequest, "dataset">) { return this.update({ ...input, dataset: "transactions" }); }
  updateInternalTransfers(input: Omit<DatasetUpdateRequest, "dataset">) { return this.update({ ...input, dataset: "internal_native" }); }

  async getStatus(input: { chain: ChainReference; address: string; dataset: SyncDataset }): Promise<SyncStatus> { const identity = this.identity(input); const row = await this.deps.storage.get<any>("SELECT next_block,target_block,last_complete_block,status,updated_at FROM sdk_sync_scopes WHERE scope_key=?", [identity.key]); return { scopeKey: identity.key, chainId: identity.chainId, address: identity.address, dataset: input.dataset, nextBlock: row?.next_block ?? null, targetBlock: row?.target_block ?? null, lastCompleteBlock: row?.last_complete_block ?? null, status: row?.status ?? "not_started", updatedAt: row?.updated_at ?? null }; }

  async update(input: DatasetUpdateRequest): Promise<DatasetUpdateResult> {
    const identity = this.identity(input);
    const scope = await this.deps.storage.get<ScopeRow>("SELECT next_block,target_block,status,updated_at FROM sdk_sync_scopes WHERE scope_key=?", [identity.key]);
    if (scope?.status === "running" && !isStale(scope.updated_at)) return this.result(input, identity, scope.next_block, scope.target_block ?? scope.next_block, null, 0, 0, 0, null, "busy");
    const cursor = normalizeBlock(scope?.next_block ?? "0");
    const explicitStart = input.fromBlock === undefined ? null : normalizeBlock(input.fromBlock);
    if (scope !== undefined && explicitStart !== null && BigInt(explicitStart) !== BigInt(scope.next_block)) {
      throw new EvmDataError({ code: "SYNC_SCOPE_CONFLICT", message: "Explicit fromBlock conflicts with persisted scope.", retryable: false, chainId: identity.chainId });
    }
    const target = normalizeBlock(input.toBlock ?? scope?.target_block ?? (await this.deps.chain.getLatestBlockNumber({ chain: input.chain, ...(input.signal === undefined ? {} : { signal: input.signal }) })).blockNumber);
    if (explicitStart === null && BigInt(cursor) > BigInt(target)) return this.result(input, identity, cursor, target, null, 0, 0, 0, null, "completed");
    const start = explicitStart ?? overlapStart(cursor, this.deps.reorgOverlapBlocks ?? 12);
    if (BigInt(start) > BigInt(target)) return this.result(input, identity, start, target, null, 0, 0, 0, null, "completed");
    const requestedWindow = input.maxBlocks === undefined ? (this.deps.maxWindowBlocks ?? 100_000) : parsePositiveWindow(input.maxBlocks);
    const windowEnd = boundedEnd(start, target, requestedWindow);
    return this.runWindow(input, identity, start, windowEnd, target, cursor);
  }

  async recollect(input: RecollectRequest): Promise<RecollectResult> {
    const from = normalizeBlock(input.fromBlock); const to = normalizeBlock(input.toBlock);
    if (BigInt(from) > BigInt(to)) throw new EvmDataError({ code: "INVALID_BLOCK_RANGE", message: "recollect requires fromBlock <= toBlock.", retryable: false });
    const identity = this.identity(input); const strategy = input.strategy ?? "replace";
    const fetched = await this.fetch(input.dataset, input.chain, identity.address, from, to, input.signal);
    const table = tableFor(input.dataset);
    const deletedEstimate = await this.deps.storage.get<{ count: number }>(`SELECT COUNT(*) AS count FROM ${table} WHERE chain_id=? AND address=? AND CAST(block_number AS INTEGER)>=CAST(? AS INTEGER) AND CAST(block_number AS INTEGER)<=CAST(? AS INTEGER) AND ingestion_source=?`, [identity.chainId, identity.address, from, to, "sdk"]);
    if (input.dryRun) {
      const base = this.result(input, identity, (BigInt(fetched.end) + 1n).toString(), to, { startBlock: fetched.start, endBlock: fetched.end }, fetched.items.length, 0, 0, fetched.provider, "completed", randomUUID(), BigInt(fetched.end) < BigInt(to));
      return { ...base, operation: "recollect", strategy, dryRun: true, recordsDeleted: Number(deletedEstimate?.count ?? 0), affectedReplayFromBlock: from };
    }
    const runId = randomUUID();
    let deleted = 0;
    let replayStatus: "queued" | "running" | "not_requested" = "not_requested";
    const written = await this.deps.storage.transaction(async () => {
      if (strategy === "replace") deleted = (await this.deps.storage.run(`DELETE FROM ${table} WHERE chain_id=? AND address=? AND CAST(block_number AS INTEGER)>=CAST(? AS INTEGER) AND CAST(block_number AS INTEGER)<=CAST(? AS INTEGER) AND ingestion_source=?`, [identity.chainId, identity.address, from, to, "sdk"])).changes;
      let count = 0; for (const item of fetched.items) { if (!await this.factExists(input.dataset, identity, item)) count += await this.writeFact(input.dataset, identity, item, fetched.provider); else await this.writeFact(input.dataset, identity, item, fetched.provider); }
      await this.invalidateReplay(identity, from);
      replayStatus = await this.commitScope(identity, from, to, fetched, runId, input.replay === true, count, fetched.items.length - count);
      return count;
    });
    const persisted = await this.deps.storage.get<{ next_block: string }>("SELECT next_block FROM sdk_sync_scopes WHERE scope_key=?", [identity.key]);
    const committedNext = persisted?.next_block ?? (BigInt(fetched.end) + 1n).toString();
    const base = this.result(input, identity, committedNext, to, { startBlock: fetched.start, endBlock: fetched.end }, fetched.items.length, written, fetched.items.length - written, fetched.provider, "completed", runId, BigInt(committedNext) <= BigInt(to));
    return { ...base, operation: "recollect", strategy, dryRun: false, recordsDeleted: deleted, affectedReplayFromBlock: from, replay: { ...base.replay, status: replayStatus } };
  }

  async audit(input: SyncAuditRequest): Promise<SyncAuditResult> {
    const identity = this.identity(input); const dataset = input.dataset ?? null;
    if (dataset === null) return { status: "incomplete", chainId: identity.chainId, address: identity.address, dataset: null, checkedRange: null, gapRanges: [], duplicateCount: 0, cursorConsistent: null, replayCoverage: await this.replayCoverage(identity), issues: [{ code: "DATASET_REQUIRED", detail: "A dataset is required for local fact audit." }] };
    const scope = await this.deps.storage.get<{ next_block: string; last_complete_block: string | null }>("SELECT next_block,last_complete_block FROM sdk_sync_scopes WHERE scope_key=?", [identity.key]);
    const table = tableFor(dataset);
    const rows = await this.deps.storage.all<{ block_number: string }>(`SELECT block_number FROM ${table} WHERE chain_id=? AND address=? ORDER BY CAST(block_number AS INTEGER)`, [identity.chainId, identity.address]);
    const gaps: { startBlock: string; endBlock: string }[] = []; let previous: bigint | null = null;
    for (const row of rows) { const block = BigInt(row.block_number); if (previous !== null && block > previous + 1n) gaps.push({ startBlock: (previous + 1n).toString(), endBlock: (block - 1n).toString() }); previous = block; }
    const cursorConsistent = scope === undefined ? null : scope.last_complete_block === null || BigInt(scope.next_block) === BigInt(scope.last_complete_block) + 1n;
    const issues = [...(gaps.length ? [{ code: "GAP", detail: "Persisted facts contain a block gap." }] : []), ...(cursorConsistent === false ? [{ code: "CURSOR", detail: "Persisted cursor is inconsistent with its last complete block." }] : [])];
    const duplicateCount = Number((await this.deps.storage.get<{ count: number }>(`SELECT COALESCE(SUM(group_count-1),0) AS count FROM (SELECT COUNT(*) AS group_count FROM ${table} WHERE chain_id=? AND address=? GROUP BY ${dataset === "erc20" ? "tx_hash,COALESCE(log_index,'') ,token_address" : dataset === "transactions" ? "tx_hash" : "tx_hash,COALESCE(trace_id,'')"} HAVING COUNT(*)>1)`, [identity.chainId, identity.address]))?.count ?? 0);
    if (duplicateCount > 0) issues.push({ code: "DUPLICATES", detail: "Persisted facts contain duplicate semantic identities." });
    return { status: issues.length ? "issues_found" : "ok", chainId: identity.chainId, address: identity.address, dataset, checkedRange: input.fromBlock && input.toBlock ? { startBlock: normalizeBlock(input.fromBlock), endBlock: normalizeBlock(input.toBlock) } : null, gapRanges: gaps.slice(0, 50), duplicateCount, cursorConsistent, replayCoverage: await this.replayCoverage(identity), issues: issues.slice(0, 50) };
  }

  private async runWindow(input: DatasetUpdateRequest, identity: Identity, start: string, windowEnd: string, overallTarget: string, cursorStart: string): Promise<DatasetUpdateResult> {
    const runId = randomUUID();
    // Claim the scope in a short transaction. A second caller observes busy before any network request.
    const claimed = await this.deps.storage.transaction(async () => {
      const current = await this.deps.storage.get<ScopeRow>("SELECT next_block,target_block,status,updated_at FROM sdk_sync_scopes WHERE scope_key=?", [identity.key]);
      if (current?.status === "running" && !isStale(current.updated_at)) return false;
      await this.deps.storage.run("INSERT OR IGNORE INTO sdk_sync_scopes(scope_key,chain_id,address,dataset,next_block,target_block,last_complete_block,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", [identity.key, identity.chainId, identity.address, input.dataset, start, overallTarget, current?.last_complete_block ?? null, "running", new Date().toISOString()]);
      await this.deps.storage.run("UPDATE sdk_sync_scopes SET target_block=?,status=?,updated_at=? WHERE scope_key=?", [overallTarget, "running", new Date().toISOString(), identity.key]);
      return true;
    });
    if (!claimed) return this.result(input, identity, start, overallTarget, null, 0, 0, 0, null, "busy", runId);
    try {
      const fetched = await this.fetch(input.dataset, input.chain, identity.address, start, windowEnd, input.signal);
      if (BigInt(fetched.end) < BigInt(cursorStart)) throw new EvmDataError({ code: "PROVIDER_STALLED", message: "Provider did not cover the persisted cursor boundary.", retryable: true, provider: fetched.provider, chainId: identity.chainId });
      let replayStatus: "queued" | "running" | "not_requested" = "not_requested";
      const written = await this.deps.storage.transaction(async () => { let count = 0; if (BigInt(start) < BigInt(cursorStart)) { await this.deps.storage.run(`DELETE FROM ${tableFor(input.dataset)} WHERE chain_id=? AND address=? AND CAST(block_number AS INTEGER)>=CAST(? AS INTEGER) AND CAST(block_number AS INTEGER)<=CAST(? AS INTEGER) AND ingestion_source=?`, [identity.chainId, identity.address, start, fetched.end, "sdk"]); await this.invalidateReplay(identity, start); } for (const item of fetched.items) { if (!await this.factExists(input.dataset, identity, item)) count += await this.writeFact(input.dataset, identity, item, fetched.provider); else await this.writeFact(input.dataset, identity, item, fetched.provider); } replayStatus = await this.commitScope(identity, start, overallTarget, fetched, runId, input.replay === true, count, fetched.items.length - count); return count; });
      const next = (BigInt(fetched.end) + 1n).toString();
      return this.result(input, identity, next, overallTarget, { startBlock: fetched.start, endBlock: fetched.end }, fetched.items.length, written, fetched.items.length - written, fetched.provider, input.replay ? ((replayStatus as string) === "running" ? "history_replay_running" : "history_replay_queued") : "completed", runId, BigInt(next) <= BigInt(overallTarget), replayStatus);
    } catch (error) {
      const safeError = error instanceof EvmDataError ? error : new EvmDataError({ code: "PROVIDER_UNAVAILABLE", message: "The configured data provider is unavailable.", retryable: true, chainId: identity.chainId, cause: error });
      await this.deps.storage.run("UPDATE sdk_sync_scopes SET status=?,updated_at=? WHERE scope_key=?", ["failed", new Date().toISOString(), identity.key]);
      await this.deps.storage.run("INSERT OR REPLACE INTO sdk_sync_runs(run_id,scope_key,requested_from,requested_to,covered_from,covered_to,status,records_seen,records_written,duplicates,provider,error_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", [runId, identity.key, start, overallTarget, null, null, "failed", 0, 0, 0, safeError.provider, errorCode(safeError), new Date().toISOString()]);
      throw safeError;
    }
  }

  private async commitScope(identity: Identity, start: string, target: string, fetched: FetchedWindow, runId: string, replay = false, recordsWritten = fetched.items.length, duplicates = 0): Promise<"queued" | "running" | "not_requested"> {
    const current = await this.deps.storage.get<{ next_block: string; last_complete_block: string | null }>("SELECT next_block,last_complete_block FROM sdk_sync_scopes WHERE scope_key=?", [identity.key]);
    const fetchedNext = BigInt(fetched.end) + 1n;
    const next = current === undefined || fetchedNext > BigInt(current.next_block) ? fetchedNext.toString() : current.next_block;
    const lastComplete = current?.last_complete_block === null || current?.last_complete_block === undefined || BigInt(fetched.end) > BigInt(current.last_complete_block) ? fetched.end : current.last_complete_block;
    await this.deps.storage.run("INSERT OR IGNORE INTO sdk_sync_scopes(scope_key,chain_id,address,dataset,next_block,target_block,last_complete_block,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", [identity.key, identity.chainId, identity.address, identity.key.slice(identity.key.lastIndexOf(":") + 1), start, target, null, "running", new Date().toISOString()]);
    await this.deps.storage.run("UPDATE sdk_sync_scopes SET next_block=?,last_complete_block=?,target_block=?,status=?,updated_at=? WHERE scope_key=?", [next, lastComplete, target, "idle", new Date().toISOString(), identity.key]);
    await this.deps.storage.run("INSERT INTO sdk_sync_runs(run_id,scope_key,requested_from,requested_to,covered_from,covered_to,status,records_seen,records_written,duplicates,provider,error_code,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", [runId, identity.key, start, target, fetched.start, fetched.end, "completed", fetched.items.length, recordsWritten, duplicates, fetched.provider, null, new Date().toISOString()]);
    await this.deps.storage.run("INSERT OR IGNORE INTO sdk_sync_windows(scope_key,start_block,end_block,run_id,committed_at) VALUES(?,?,?,?,?)", [identity.key, fetched.start, fetched.end, runId, new Date().toISOString()]);
    return replay ? await this.enqueueReplay(identity, fetched.start, fetched.end) : "not_requested";
  }

  private async enqueueReplay(identity: Identity, from: string, to: string): Promise<"queued" | "running"> {
    const current = await this.deps.storage.get<{ job_id: string; from_block: string; to_block: string | null; facts_revision: string; status: string }>("SELECT job_id,from_block,to_block,facts_revision,status FROM sdk_replay_jobs WHERE chain_id=? AND address=? AND status IN ('queued','running') LIMIT 1", [identity.chainId, identity.address]);
    const jobId = current?.job_id ?? randomUUID(); const start = current === undefined || BigInt(from) < BigInt(current.from_block) ? from : current.from_block; const end = current?.to_block !== null && current?.to_block !== undefined && BigInt(current.to_block) > BigInt(to) ? current.to_block : to;
    await this.deps.storage.run("INSERT OR REPLACE INTO sdk_replay_jobs(job_id,chain_id,address,from_block,to_block,status,facts_revision,updated_at,processed_events) VALUES(?,?,?,?,?,?,?,?,COALESCE((SELECT processed_events FROM sdk_replay_jobs WHERE job_id=?),0))", [jobId, identity.chainId, identity.address, start, end, current?.status === "running" ? "running" : "queued", current?.facts_revision ?? randomUUID(), new Date().toISOString(), jobId]);
    return current?.status === "running" ? "running" : "queued";
  }

  private async invalidateReplay(identity: Identity, from: string): Promise<void> {
    await this.deps.storage.run("DELETE FROM sdk_user_state_snapshots WHERE chain_id=? AND address=? AND CAST(block_number AS INTEGER)>=CAST(? AS INTEGER)", [identity.chainId, identity.address, from]);
    await this.deps.storage.run("DELETE FROM sdk_replay_current WHERE chain_id=? AND address=?", [identity.chainId, identity.address]);
  }

  private async fetch(dataset: SyncDataset, chain: ChainReference, address: string, start: string, end: string, signal?: AbortSignal): Promise<FetchedWindow> {
    const options = signal === undefined ? {} : { signal };
    if (dataset === "erc20") { const result = await this.deps.token.getErc20TransfersByBlockRange({ chain, address, startBlock: start, endBlock: end, ...options }); return { items: [...result.items], start: result.range.startBlock, end: result.range.endBlock, provider: result.providers[0] ?? "unknown" }; }
    if (dataset === "transactions") { const result = await this.deps.address.getTransactionsByBlockRange({ chain, address, startBlock: start, endBlock: end, ...options }); return { items: [...result.items], start: result.range.startBlock, end: result.range.endBlock, provider: result.provider }; }
    const result = await this.deps.address.getInternalNativeTransfersByBlockRange({ chain, address, startBlock: start, endBlock: end, ...options }); return { items: [...result.items], start: result.range.startBlock, end: result.range.endBlock, provider: result.provider };
  }

  private async writeFact(dataset: SyncDataset, identity: Identity, item: any, provider: string): Promise<number> {
    const source = "sdk";
    if (dataset === "erc20") { const factIdentity = erc20Identity(identity.chainId, item); return (await this.deps.storage.run("INSERT OR REPLACE INTO sdk_erc20_transfers(identity,chain_id,address,token_address,tx_hash,transaction_index,log_index,block_number,timestamp,token_name,token_symbol,token_decimals,from_address,to_address,amount,provider,ingestion_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [factIdentity, identity.chainId, identity.address, item.tokenAddress.toLowerCase(), item.transactionHash, item.transactionIndex, item.logIndex, item.blockNumber, item.timestamp, item.tokenName, item.tokenSymbol, item.tokenDecimals, item.from.toLowerCase(), item.to.toLowerCase(), item.amount, provider, source])).changes; }
    const factIdentity = dataset === "internal_native" ? internalIdentity(identity.chainId, item) : `${identity.chainId}:${item.transactionHash ?? item.hash}`;
    if (dataset === "transactions") return (await this.deps.storage.run("INSERT OR REPLACE INTO sdk_transactions(identity,chain_id,address,tx_hash,block_number,payload,provider,ingestion_source) VALUES(?,?,?,?,?,?,?,?)", [factIdentity, identity.chainId, identity.address, item.hash, item.blockNumber, JSON.stringify(item), provider, source])).changes;
    return (await this.deps.storage.run("INSERT OR REPLACE INTO sdk_internal_native_transfers(identity,chain_id,address,tx_hash,trace_id,block_number,payload,provider,ingestion_source) VALUES(?,?,?,?,?,?,?,?,?)", [factIdentity, identity.chainId, identity.address, item.transactionHash, item.traceId, item.blockNumber, JSON.stringify(item), provider, source])).changes;
  }

  private async factExists(dataset: SyncDataset, identity: Identity, item: any): Promise<boolean> { const factIdentity = dataset === "erc20" ? erc20Identity(identity.chainId, item) : dataset === "internal_native" ? internalIdentity(identity.chainId, item) : `${identity.chainId}:${item.transactionHash ?? item.hash}`; return (await this.deps.storage.get("SELECT 1 AS present FROM " + tableFor(dataset) + " WHERE identity=? LIMIT 1", [factIdentity])) !== undefined; }

  private identity(input: { chain: ChainReference; address: string; dataset?: SyncDataset }): Identity { const chainId = this.deps.resolveChain(input.chain).chainId; const address = input.address.toLowerCase(); return { chainId, address, key: `${chainId}:${address}:${input.dataset ?? ""}` }; }
  private async replayCoverage(identity: Identity): Promise<{ asOfBlock: string | null; revision: string | null }> { const row = await this.deps.storage.get<{ as_of_block: string | null; revision: string }>("SELECT as_of_block,revision FROM sdk_replay_current WHERE chain_id=? AND address=?", [identity.chainId, identity.address]); return { asOfBlock: row?.as_of_block ?? null, revision: row?.revision ?? null }; }
  private result(input: DatasetUpdateRequest, identity: Identity, next: string, target: string, covered: { startBlock: string; endBlock: string } | null, seen: number, written: number, duplicates: number, provider: string | null, status: DatasetUpdateResult["status"], runId = randomUUID(), hasNext = BigInt(next) <= BigInt(target), replayStatus: string = input.replay ? "queued" : "not_requested"): DatasetUpdateResult { return { operation: "update", status, chainId: identity.chainId, address: identity.address, dataset: input.dataset, targetBlock: target, requestedRange: { startBlock: covered?.startBlock ?? next, endBlock: target }, coveredRange: covered, nextBlock: next, recordsSeen: seen, recordsWritten: written, duplicates, duplicateRecords: duplicates, provider, runId, replay: { requested: input.replay === true, status: replayStatus, runId: input.replay ? runId : null }, hasNext }; }
}

interface ScopeRow { next_block: string; target_block: string | null; last_complete_block: string | null; status: string; updated_at: string; }
interface Identity { chainId: number; address: string; key: string; }
function normalizeBlock(value: string): string { if (!/^[0-9]+$/.test(value)) throw new EvmDataError({ code: "SYNC_CURSOR_INVALID", message: "Block cursor must be a decimal string.", retryable: false }); return BigInt(value).toString(); }
function tableFor(dataset: SyncDataset): string { return dataset === "erc20" ? "sdk_erc20_transfers" : dataset === "transactions" ? "sdk_transactions" : "sdk_internal_native_transfers"; }
function isStale(updatedAt: string): boolean { const time = Date.parse(updatedAt); return !Number.isFinite(time) || Date.now() - time > 5 * 60_000; }
function boundedEnd(start: string, target: string, maxWindowBlocks: number): string { const end = BigInt(start) + BigInt(Math.max(1, maxWindowBlocks)) - 1n; return end < BigInt(target) ? end.toString() : target; }
function parsePositiveWindow(value: string): number { if (!/^\d+$/.test(value)) throw new EvmDataError({ code: "SYNC_CURSOR_INVALID", message: "maxBlocks must be a positive decimal string.", retryable: false }); const parsed = Number(value); if (!Number.isSafeInteger(parsed) || parsed < 1) throw new EvmDataError({ code: "SYNC_CURSOR_INVALID", message: "maxBlocks must be a positive decimal string.", retryable: false }); return parsed; }
function errorCode(error: unknown): string { return error instanceof EvmDataError ? error.code : "PROVIDER_UNAVAILABLE"; }
function erc20Identity(chainId: number, item: any): string { const token = String(item.tokenAddress ?? "").toLowerCase(); const tx = String(item.transactionHash ?? ""); if (item.logIndex !== undefined && item.logIndex !== null) return `${chainId}:${tx}:${item.logIndex}:${token}`; return `${chainId}:${tx}:hash:${fieldHash([token, item.transactionIndex ?? null, item.blockNumber ?? null, item.timestamp ?? null, String(item.from ?? "").toLowerCase(), String(item.to ?? "").toLowerCase(), item.amount ?? null])}`; }
function internalIdentity(chainId: number, item: any): string { const tx = String(item.transactionHash ?? item.hash ?? ""); if (item.traceId !== undefined && item.traceId !== null) return `${chainId}:${tx}:${item.traceId}`; return `${chainId}:${tx}:hash:${fieldHash([item.blockNumber ?? null, item.timestamp ?? null, item.type ?? null, item.status ?? null, item.value ?? null, String(item.from ?? "").toLowerCase(), String(item.to ?? "").toLowerCase()])}`; }
function fieldHash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32); }
function overlapStart(cursor: string, overlap: number): string { const value = BigInt(cursor) - BigInt(Math.max(0, overlap)); return value > 0n ? value.toString() : "0"; }
