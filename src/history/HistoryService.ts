import { createHash, randomUUID } from "node:crypto";
import type { StorageAdapter } from "../storage/StorageAdapter";
import { EvmDataError } from "../domain/errors";
import type { ChainReference } from "../domain/chains";
import type { HistoryAddressRequest, HistoryInitialState, ReplayStatus, UserStateAtBlockRequest, UserStateAtBlockResult, TokenFlowHistoryRequest, HistoryReplayRequest, HistoryRebuildRequest, HistoryReplayResult, HistoryRebuildResult } from "../domain/historyModels";

interface Deps { storage: StorageAdapter; resolveChain: (chain: ChainReference) => { chainId: number }; snapshotEveryEvents?: number; snapshotEveryBlocks?: number; leaseMs?: number; }
interface Fact { block: bigint; tx: string; index: bigint; identity: string; kind: "erc20" | "tx" | "internal"; row: any; }
interface Identity { chainId: number; address: string; }
type StatePayload = Omit<UserStateAtBlockResult, "state" | "revision" | "asOfBlock">;
interface NormalizedInitialState { blockNumber: string; state: StatePayload; canonical: string; }

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const WRAPPED_NATIVE_ADDRESSES: Record<number, string> = {
  1: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  8453: "0x4200000000000000000000000000000000000006",
  10: "0x4200000000000000000000000000000000000006",
  42161: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
  137: "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
  56: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
};

/** Facts-only reducer. Derived snapshots are revisioned and can always be rebuilt. */
export class HistoryService {
  constructor(private readonly deps: Deps) {}

  async heartbeat(jobId: string, owner: string, leaseMs = this.deps.leaseMs ?? 60_000): Promise<boolean> { return (await this.deps.storage.run("UPDATE sdk_replay_jobs SET lease_until=?,heartbeat_at=?,updated_at=? WHERE job_id=? AND lease_owner=? AND status='running'", [new Date(Date.now() + leaseMs).toISOString(), new Date().toISOString(), new Date().toISOString(), jobId, owner])).changes === 1; }

  async getReplayStatus(input: HistoryAddressRequest): Promise<ReplayStatus> { const id = this.identity(input); const row = await this.deps.storage.get<any>("SELECT * FROM sdk_replay_jobs WHERE chain_id=? AND address=? ORDER BY updated_at DESC LIMIT 1", [id.chainId, id.address]); const current = await this.deps.storage.get<any>("SELECT * FROM sdk_replay_current WHERE chain_id=? AND address=?", [id.chainId, id.address]); return { requested: row !== undefined, runId: row?.job_id ?? null, status: row?.status ?? "not_requested", fromBlock: row?.from_block ?? null, toBlock: row?.to_block ?? null, processedEvents: row?.processed_events ?? 0, snapshotBlock: current?.as_of_block ?? null, revision: current?.revision ?? null }; }

  async replay(input: HistoryReplayRequest): Promise<HistoryReplayResult> {
    const id = this.identity(input);
    const explicitInitial = input.initialState !== undefined;
    let initial = input.initialState === undefined ? null : normalizeInitialState(input.initialState);
    const current = await this.deps.storage.get<{ revision: string }>(
      "SELECT revision FROM sdk_replay_current WHERE chain_id=? AND address=?",
      [id.chainId, id.address],
    );
    if (initial === null && current !== undefined) {
      const storedInitial = await this.deps.storage.get<{ block_number: string; payload: string }>(
        "SELECT block_number,payload FROM sdk_replay_initial_states WHERE chain_id=? AND address=? AND revision=?",
        [id.chainId, id.address, current.revision],
      );
      if (storedInitial !== undefined) {
        initial = normalizeInitialState({ blockNumber: storedInitial.block_number, ...JSON.parse(storedInitial.payload) });
      }
    }
    const latestSnapshot = !explicitInitial && input.fromBlock === undefined && input.force !== true && current !== undefined
      ? await this.deps.storage.get<{ block_number: string; payload: string }>(
        "SELECT block_number,payload FROM sdk_user_state_snapshots WHERE chain_id=? AND address=? AND revision=? ORDER BY CAST(block_number AS INTEGER) DESC LIMIT 1",
        [id.chainId, id.address, current.revision],
      )
      : undefined;
    const requestedFrom = input.fromBlock
      ?? (latestSnapshot !== undefined
        ? (BigInt(latestSnapshot.block_number) + 1n).toString()
        : initial === null
          ? "0"
          : (initial.blockNumber === "0" ? "1" : (BigInt(initial.blockNumber) + 1n).toString()));
    const replayBaseBlock = latestSnapshot?.block_number ?? initial?.blockNumber ?? null;
    if (replayBaseBlock !== null && BigInt(requestedFrom) <= BigInt(replayBaseBlock)) {
      throw new EvmDataError({ code: "INVALID_REQUEST", message: "Replay fromBlock must be greater than the replay base block.", retryable: false });
    }
    if (input.toBlock !== undefined && replayBaseBlock !== null && BigInt(input.toBlock) < BigInt(replayBaseBlock)) {
      throw new EvmDataError({ code: "INVALID_REQUEST", message: "Replay toBlock must not be before the replay base block.", retryable: false });
    }
    const revision = input.force === true
      ? randomUUID()
      : explicitInitial && initial !== null
        ? `initial-${historyQueryHash([id.chainId, id.address, initial.canonical])}`
        : (current?.revision ?? (initial === null ? randomUUID() : `initial-${historyQueryHash([id.chainId, id.address, initial.canonical])}`));
    const requestedJobId = randomUUID();
    const owner = randomUUID();
    const now = Date.now();
    const leaseUntil = new Date(now + (this.deps.leaseMs ?? 60_000)).toISOString();
    const claimed = await this.deps.storage.transaction(async () => {
      const running = await this.deps.storage.get<{ job_id: string; revision: string; lease_until: string | null; from_block: string; to_block: string | null }>(
        "SELECT job_id,facts_revision AS revision,lease_until,from_block,to_block FROM sdk_replay_jobs WHERE chain_id=? AND address=? AND status='running' ORDER BY updated_at DESC LIMIT 1",
        [id.chainId, id.address],
      );
      if (running !== undefined && running.lease_until !== null && Date.parse(running.lease_until) > now) {
        if (initial !== null && running.revision !== revision) return { acquired: false, jobId: running.job_id, revision: running.revision };
        const mergedFrom = BigInt(requestedFrom) < BigInt(running.from_block) ? requestedFrom : running.from_block;
        const mergedTo = running.to_block === null || input.toBlock === undefined
          ? running.to_block ?? input.toBlock ?? null
          : BigInt(input.toBlock) > BigInt(running.to_block) ? input.toBlock : running.to_block;
        await this.deps.storage.run("UPDATE sdk_replay_jobs SET from_block=?,to_block=?,updated_at=? WHERE job_id=?", [mergedFrom, mergedTo, new Date().toISOString(), running.job_id]);
        return { acquired: false, jobId: running.job_id, revision: running.revision };
      }
      if (running !== undefined) await this.deps.storage.run("UPDATE sdk_replay_jobs SET status='failed',updated_at=?,lease_owner=NULL,lease_until=NULL WHERE job_id=?", [new Date().toISOString(), running.job_id]);
      await this.deps.storage.run("INSERT OR REPLACE INTO sdk_replay_jobs(job_id,chain_id,address,from_block,to_block,status,facts_revision,updated_at,processed_events,lease_owner,lease_until,heartbeat_at,attempts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,COALESCE((SELECT attempts FROM sdk_replay_jobs WHERE job_id=?),0)+1)", [requestedJobId, id.chainId, id.address, requestedFrom, input.toBlock ?? null, "running", revision, new Date().toISOString(), 0, owner, leaseUntil, new Date().toISOString(), requestedJobId]);
      return { acquired: true, jobId: requestedJobId, revision };
    });
    if (!claimed.acquired) return { status: "busy", jobId: claimed.jobId, revision: claimed.revision, chainId: id.chainId, address: id.address, targetBlock: input.toBlock ?? null };
    try {
      const facts = await this.facts(id);
      const resumeState = latestSnapshot === undefined
        ? initial
        : {
          blockNumber: canonicalDecimal(latestSnapshot.block_number),
          state: JSON.parse(latestSnapshot.payload) as StatePayload,
        };
      const latestReplayFact = resumeState === null
        ? facts.at(-1)
        : facts.filter((fact) => fact.block >= BigInt(requestedFrom)).at(-1);
      const to = input.toBlock === undefined ? (latestReplayFact?.block.toString() ?? resumeState?.blockNumber ?? null) : input.toBlock;
      const filtered = facts.filter((fact) => to === null || fact.block <= BigInt(to));
      const replayFacts = resumeState === null ? filtered : filtered.filter((fact) => fact.block >= BigInt(requestedFrom));
      const reductionFacts = resumeState === null ? filtered : replayFacts;
      const snapshots = buildSnapshots(
        reductionFacts,
        id.address,
        this.deps.snapshotEveryEvents ?? 10_000,
        this.deps.snapshotEveryBlocks ?? 10_000,
        resumeState === null ? undefined : { block: resumeState.blockNumber, state: resumeState.state },
      ).filter((snapshot) => BigInt(snapshot.block) >= BigInt(requestedFrom));
      const asOf = filtered.at(-1)?.block.toString() ?? resumeState?.blockNumber ?? null;
      const processed = resumeState === null ? filtered.filter((fact) => fact.block >= BigInt(requestedFrom)).length : replayFacts.length;
      await this.deps.storage.transaction(async () => {
        if (input.force !== true) await this.deps.storage.run("DELETE FROM sdk_user_state_snapshots WHERE chain_id=? AND address=? AND revision=? AND CAST(block_number AS INTEGER)>=CAST(? AS INTEGER)", [id.chainId, id.address, claimed.revision, requestedFrom]);
        if (initial !== null) {
          await this.deps.storage.run("INSERT OR REPLACE INTO sdk_replay_initial_states(chain_id,address,revision,block_number,payload,complete) VALUES(?,?,?,?,?,1)", [id.chainId, id.address, claimed.revision, initial.blockNumber, JSON.stringify(initial.state)]);
          await this.deps.storage.run("INSERT OR REPLACE INTO sdk_user_state_snapshots(chain_id,address,revision,block_number,payload,complete) VALUES(?,?,?,?,?,1)", [id.chainId, id.address, claimed.revision, initial.blockNumber, JSON.stringify(initial.state)]);
        }
        await this.deps.storage.run("UPDATE sdk_replay_jobs SET status=?,updated_at=?,processed_events=?,lease_owner=NULL,lease_until=NULL,heartbeat_at=NULL WHERE job_id=? AND lease_owner=?", ["completed", new Date().toISOString(), processed, claimed.jobId, owner]);
        for (const snapshot of snapshots) await this.deps.storage.run("INSERT OR REPLACE INTO sdk_user_state_snapshots(chain_id,address,revision,block_number,payload,complete) VALUES(?,?,?,?,?,1)", [id.chainId, id.address, claimed.revision, snapshot.block, JSON.stringify(snapshot.state)]);
        if (asOf !== null) await this.deps.storage.run("INSERT OR REPLACE INTO sdk_replay_current(chain_id,address,revision,as_of_block) VALUES(?,?,?,?)", [id.chainId, id.address, claimed.revision, asOf]);
      });
      return { status: "completed", jobId: claimed.jobId, revision: claimed.revision, chainId: id.chainId, address: id.address, targetBlock: to };
    } catch (error) {
      await this.deps.storage.run("UPDATE sdk_replay_jobs SET status=?,updated_at=?,lease_owner=NULL,lease_until=NULL WHERE job_id=? AND lease_owner=?", ["failed", new Date().toISOString(), claimed.jobId, owner]);
      throw error;
    }
  }

  async rebuild(input: HistoryRebuildRequest): Promise<HistoryRebuildResult> {
    const id = this.identity(input);
    const current = await this.deps.storage.get<{ revision: string }>("SELECT revision FROM sdk_replay_current WHERE chain_id=? AND address=?", [id.chainId, id.address]);
    const from = input.mode === "full" ? null : input.fromBlock ?? "0";
    const invalidated = current === undefined ? 0 : Number(
      from === null
        ? (await this.deps.storage.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM sdk_user_state_snapshots WHERE chain_id=? AND address=? AND revision=?",
            [id.chainId, id.address, current.revision],
          ))?.count ?? 0
        : (await this.deps.storage.get<{ count: number }>(
            "SELECT COUNT(*) AS count FROM sdk_user_state_snapshots WHERE chain_id=? AND address=? AND revision=? AND CAST(block_number AS INTEGER)>=CAST(? AS INTEGER)",
            [id.chainId, id.address, current.revision, from],
          ))?.count ?? 0
    );
    const result = await this.replay({ ...input, force: true });
    return { ...result, mode: input.mode ?? "targeted", invalidatedFromBlock: from, snapshotsInvalidated: invalidated, factsRevision: result.revision, replayRevision: result.revision };
  }

  async getUserStateAtBlock(input: UserStateAtBlockRequest): Promise<UserStateAtBlockResult> {
    const id = this.identity(input);
    const target = BigInt(input.blockNumber);
    const current = await this.deps.storage.get<any>("SELECT * FROM sdk_replay_current WHERE chain_id=? AND address=?", [id.chainId, id.address]);
    if (current === undefined) return emptyState("unavailable");
    const initialRow = await this.deps.storage.get<{ block_number: string; payload: string }>("SELECT block_number,payload FROM sdk_replay_initial_states WHERE chain_id=? AND address=? AND revision=?", [id.chainId, id.address, current.revision]);
    const initial = initialRow === undefined ? null : { block: BigInt(initialRow.block_number), state: JSON.parse(initialRow.payload) as StatePayload };
    if (initial !== null && target < initial.block) return emptyState("unavailable");
    const facts = (await this.facts(id)).filter((fact) => fact.block <= target && (initial === null || fact.block > initial.block));
    const state = reduceFacts(facts, id.address, initial?.state);
    const asOf = facts.at(-1)?.block.toString() ?? initial?.block.toString() ?? null;
    return { ...state, state: current.as_of_block !== null && BigInt(current.as_of_block) >= target ? "ready" : "building", revision: current.revision, asOfBlock: asOf };
  }

  async getTokenFlowHistory(input: TokenFlowHistoryRequest) { const id = this.identity(input); const direction = input.direction ?? "both"; const queryHash = historyQueryHash(["erc20", id.chainId, id.address, input.startBlock, input.endBlock, input.tokenAddress?.toLowerCase() ?? null, direction]); const cursor = decodeCursor(input.cursor); validateCursor(cursor, queryHash); const clauses = ["chain_id=?", "address=?", "CAST(block_number AS INTEGER)>=CAST(? AS INTEGER)", "CAST(block_number AS INTEGER)<=CAST(? AS INTEGER)"]; const params: unknown[] = [id.chainId, id.address, input.startBlock, input.endBlock]; if (input.tokenAddress !== undefined) { clauses.push("token_address=?"); params.push(input.tokenAddress.toLowerCase()); } if (direction === "incoming") { clauses.push("to_address=?"); params.push(id.address); } else if (direction === "outgoing") { clauses.push("from_address=?"); params.push(id.address); } appendCursor(clauses, params, cursor); const limit = input.limit ?? 100; params.push(limit); const rows = await this.deps.storage.all<any>(`SELECT * FROM sdk_erc20_transfers WHERE ${clauses.join(" AND ")} ORDER BY CAST(block_number AS INTEGER),CAST(COALESCE(transaction_index,'0') AS INTEGER),CAST(COALESCE(log_index,'0') AS INTEGER),identity LIMIT ?`, params); const result = rows.map((row: any) => ({ chainId: id.chainId, transactionHash: row.tx_hash, blockNumber: row.block_number, transactionIndex: row.transaction_index, logIndex: row.log_index, tokenAddress: row.token_address, from: row.from_address, to: row.to_address, amount: row.amount, direction: row.to_address === id.address ? "incoming" : "outgoing" })); return withNextCursor(result, rows.length === limit && rows.at(-1) !== undefined ? encodeCursor({ block: rows.at(-1)!.block_number, transactionIndex: rows.at(-1)!.transaction_index ?? "0", logIndex: rows.at(-1)!.log_index ?? "0", identity: rows.at(-1)!.identity, queryHash }) : null); }
  async getTransactions(input: HistoryAddressRequest & { startBlock?: string; endBlock?: string; limit?: number; cursor?: string }) { return this.queryPayload("sdk_transactions", input, "hash"); }
  async getInternalNativeTransfers(input: HistoryAddressRequest & { startBlock?: string; endBlock?: string; limit?: number; cursor?: string }) { return this.queryPayload("sdk_internal_native_transfers", input, "transactionHash"); }

  private async queryPayload(table: string, input: HistoryAddressRequest & { startBlock?: string; endBlock?: string; limit?: number; cursor?: string }, key: string) { const id = this.identity(input); const queryHash = historyQueryHash([table, id.chainId, id.address, input.startBlock ?? null, input.endBlock ?? null]); const cursor = decodeCursor(input.cursor); validateCursor(cursor, queryHash); const clauses = ["chain_id=?", "address=?"]; const params: unknown[] = [id.chainId, id.address]; if (input.startBlock !== undefined) { clauses.push("CAST(block_number AS INTEGER)>=CAST(? AS INTEGER)"); params.push(input.startBlock); } if (input.endBlock !== undefined) { clauses.push("CAST(block_number AS INTEGER)<=CAST(? AS INTEGER)"); params.push(input.endBlock); } appendCursor(clauses, params, cursor); const limit = input.limit ?? 100; params.push(limit); const rows = await this.deps.storage.all<any>(`SELECT payload,block_number,identity FROM ${table} WHERE ${clauses.join(" AND ")} ORDER BY CAST(block_number AS INTEGER),identity LIMIT ?`, params); const result = rows.map((row: any) => JSON.parse(row.payload)).map((row: any) => ({ ...row, [key]: row[key] })); return withNextCursor(result, rows.length === limit && rows.at(-1) !== undefined ? encodeCursor({ block: rows.at(-1)!.block_number, identity: rows.at(-1)!.identity, queryHash }) : null); }

  private async facts(id: Identity): Promise<Fact[]> {
    const transfers = (await this.deps.storage.all<any>("SELECT * FROM sdk_erc20_transfers WHERE chain_id=? AND address=?", [id.chainId, id.address])).map((row: any) => ({ block: BigInt(row.block_number), tx: row.tx_hash, index: decimalIndex(row.log_index), identity: row.identity, kind: "erc20" as const, row }));
    const rawTransactions = (await this.deps.storage.all<any>("SELECT * FROM sdk_transactions WHERE chain_id=? AND address=?", [id.chainId, id.address])).map((row: any) => ({ block: BigInt(row.block_number), tx: row.tx_hash, index: decimalIndex(row.transaction_index), identity: row.identity, kind: "tx" as const, row }));
    const rawInternals = (await this.deps.storage.all<any>("SELECT * FROM sdk_internal_native_transfers WHERE chain_id=? AND address=?", [id.chainId, id.address])).map((row: any) => ({ block: BigInt(row.block_number), tx: row.tx_hash, index: decimalIndex(row.trace_id), identity: row.identity, kind: "internal" as const, row }));

    const { transactions, internals } = deduplicateCrossSourceNativeFacts(rawTransactions, rawInternals);

    const wrappedNative = WRAPPED_NATIVE_ADDRESSES[id.chainId]?.toLowerCase();
    const synthesized: Fact[] = [];

    if (wrappedNative) {
      for (const tx of transactions) {
        try {
          const payload = typeof tx.row.payload === "string" ? JSON.parse(tx.row.payload) : tx.row.payload;
          const toAddr = payload?.to?.toLowerCase();
          const fromAddr = payload?.from?.toLowerCase();
          const inputData = String(payload?.input ?? payload?.data ?? "").toLowerCase();
          const val = BigInt(payload?.value ?? "0");

          if (toAddr === wrappedNative && fromAddr === id.address) {
            if ((inputData.startsWith("0xd0e30db0") || inputData === "" || inputData === "0x") && val > 0n) {
              const hasCanonical = transfers.some((t) => t.tx.toLowerCase() === tx.tx.toLowerCase() && t.row.token_address.toLowerCase() === wrappedNative && t.row.to_address.toLowerCase() === id.address);
              if (!hasCanonical) {
                synthesized.push({
                  block: tx.block,
                  tx: tx.tx,
                  index: -1100000001n,
                  identity: `${id.chainId}:${tx.tx}:weth_deposit`,
                  kind: "erc20",
                  row: {
                    block_number: tx.block.toString(),
                    tx_hash: tx.tx,
                    token_address: wrappedNative,
                    from_address: ZERO_ADDRESS,
                    to_address: id.address,
                    amount: val.toString(),
                    log_index: -1100000001,
                    ingestion_source: "sdk_weth_deposit",
                  },
                });
              }
            }

            if (inputData.startsWith("0x2e1a7d4d") && inputData.length >= 74) {
              const amountRaw = BigInt("0x" + inputData.slice(10, 74));
              if (amountRaw > 0n) {
                const hasCanonical = transfers.some((t) => t.tx.toLowerCase() === tx.tx.toLowerCase() && t.row.token_address.toLowerCase() === wrappedNative && t.row.from_address.toLowerCase() === id.address);
                if (!hasCanonical) {
                  synthesized.push({
                    block: tx.block,
                    tx: tx.tx,
                    index: -1100000000n,
                    identity: `${id.chainId}:${tx.tx}:weth_withdrawal`,
                    kind: "erc20",
                    row: {
                      block_number: tx.block.toString(),
                      tx_hash: tx.tx,
                      token_address: wrappedNative,
                      from_address: id.address,
                      to_address: ZERO_ADDRESS,
                      amount: amountRaw.toString(),
                      log_index: -1100000000,
                      ingestion_source: "sdk_weth_withdrawal",
                    },
                  });
                }
              }
            }
          }
        } catch {
          // ignore malformed payloads
        }
      }
    }

    return [...transfers, ...synthesized, ...transactions, ...internals].sort(compareFacts);
  }
  private identity(input: HistoryAddressRequest): Identity { return { chainId: this.deps.resolveChain(input.chain).chainId, address: input.address.toLowerCase() }; }
}

function deduplicateCrossSourceNativeFacts(
  transactions: readonly Fact[],
  internals: readonly Fact[],
): { transactions: Fact[]; internals: Fact[] } {
  const groups = new Map<string, { txs: Fact[]; internals: Fact[] }>();

  for (const fact of transactions) {
    try {
      const payload = typeof fact.row.payload === "string" ? JSON.parse(fact.row.payload) : fact.row.payload;
      const val = BigInt(payload?.value ?? "0");
      if (val > 0n) {
        const from = String(payload?.from ?? "").toLowerCase();
        const to = String(payload?.to ?? "").toLowerCase();
        const key = `${fact.tx.toLowerCase()}:${from}:${to}:${val.toString()}`;
        const group = groups.get(key) ?? { txs: [], internals: [] };
        group.txs.push(fact);
        groups.set(key, group);
      }
    } catch {
      // ignore malformed payload
    }
  }

  for (const fact of internals) {
    try {
      const payload = typeof fact.row.payload === "string" ? JSON.parse(fact.row.payload) : fact.row.payload;
      const val = BigInt(payload?.value ?? "0");
      if (val > 0n) {
        const from = String(payload?.from ?? "").toLowerCase();
        const to = String(payload?.to ?? "").toLowerCase();
        const key = `${fact.tx.toLowerCase()}:${from}:${to}:${val.toString()}`;
        const group = groups.get(key) ?? { txs: [], internals: [] };
        group.internals.push(fact);
        groups.set(key, group);
      }
    } catch {
      // ignore malformed payload
    }
  }

  const internalIdsToExclude = new Set<string>();
  for (const group of groups.values()) {
    if (group.txs.length > 0 && group.internals.length > 0) {
      const dropCount = Math.min(group.txs.length, group.internals.length);
      for (let i = 0; i < dropCount; i++) {
        internalIdsToExclude.add(group.internals[i]!.identity);
      }
    }
  }

  return {
    transactions: [...transactions],
    internals: internals.filter((f) => !internalIdsToExclude.has(f.identity)),
  };
}

function emptyState(state: UserStateAtBlockResult["state"]): UserStateAtBlockResult { return { state, revision: null, asOfBlock: null, balances: [], nativeBalance: "0", nativeIn: "0", nativeOut: "0", transactionCount: 0, warnings: [] }; }
function normalizeInitialState(input: HistoryInitialState): NormalizedInitialState {
  if (!/^\d+$/.test(input.blockNumber)) throw new EvmDataError({ code: "INVALID_REQUEST", message: "initialState.blockNumber must be a decimal string.", retryable: false });
  const blockNumber = canonicalDecimal(input.blockNumber);
  const seen = new Set<string>();
  const balances = input.balances.map((balance) => {
    const tokenAddress = balance.tokenAddress.toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(tokenAddress) || seen.has(tokenAddress)) throw new EvmDataError({ code: "INVALID_REQUEST", message: "initialState contains an invalid or duplicate token address.", retryable: false });
    seen.add(tokenAddress);
    const amount = decimalAmount(balance.amount, "initialState balance");
    const incoming = decimalAmount(balance.incoming ?? "0", "initialState incoming");
    const outgoing = decimalAmount(balance.outgoing ?? "0", "initialState outgoing");
    return { tokenAddress, amount, incoming, outgoing };
  }).sort((a, b) => a.tokenAddress.localeCompare(b.tokenAddress));
  const state: StatePayload = {
    balances,
    nativeBalance: decimalAmount(input.nativeBalance ?? "0", "initialState nativeBalance"),
    nativeIn: decimalAmount(input.nativeIn ?? "0", "initialState nativeIn"),
    nativeOut: decimalAmount(input.nativeOut ?? "0", "initialState nativeOut"),
    transactionCount: input.transactionCount ?? 0,
    warnings: [...(input.warnings ?? [])],
  };
  if (!Number.isSafeInteger(state.transactionCount) || state.transactionCount < 0) throw new EvmDataError({ code: "INVALID_REQUEST", message: "initialState.transactionCount must be a non-negative safe integer.", retryable: false });
  return { blockNumber, state, canonical: JSON.stringify({ blockNumber, ...state }) };
}
function decimalAmount(value: string, label: string): string { if (!/^\d+$/.test(value)) throw new EvmDataError({ code: "INVALID_REQUEST", message: `${label} must be a decimal string.`, retryable: false }); return canonicalDecimal(value); }
function canonicalDecimal(value: string): string { const canonical = value.replace(/^0+(?=\d)/, ""); return canonical === "" ? "0" : canonical; }
function buildSnapshots(facts: readonly Fact[], address: string, eventThreshold: number, blockThreshold: number, initial?: { block: string; state: StatePayload }): { block: string; state: StatePayload }[] { const result: { block: string; state: StatePayload }[] = []; if (initial !== undefined) result.push(initial); if (facts.length === 0) return result; let blockStart = facts[0]!.block; let eventStart = 0; let index = 0; while (index < facts.length) { const block = facts[index]!.block; while (index < facts.length && facts[index]!.block === block) index++; const reached = index - eventStart >= Math.max(1, eventThreshold) || block - blockStart + 1n >= BigInt(Math.max(1, blockThreshold)) || index === facts.length; if (reached) { result.push({ block: block.toString(), state: reduceFacts(facts.slice(0, index), address, initial?.state) }); blockStart = block + 1n; eventStart = index; } } return result; }
function reduceFacts(facts: Fact[], address: string, base?: StatePayload): StatePayload {
  const normalizedAddress = address.toLowerCase();
  const balances = new Map<string, bigint>((base?.balances ?? []).map((item) => [item.tokenAddress.toLowerCase(), BigInt(item.amount)]));
  const incoming = new Map<string, bigint>((base?.balances ?? []).map((item) => [item.tokenAddress.toLowerCase(), BigInt(item.incoming)]));
  const outgoing = new Map<string, bigint>((base?.balances ?? []).map((item) => [item.tokenAddress.toLowerCase(), BigInt(item.outgoing)]));
  let nativeIn = BigInt(base?.nativeIn ?? "0");
  let nativeOut = BigInt(base?.nativeOut ?? "0");
  let nativeBalance = BigInt(base?.nativeBalance ?? "0");
  let transactionCount = base?.transactionCount ?? 0;
  const warnings: string[] = [...(base?.warnings ?? [])];

  const txTokenOutflows = new Set<string>();
  for (const fact of facts) {
    if (fact.kind === "erc20" && fact.row.from_address?.toLowerCase() === normalizedAddress) {
      txTokenOutflows.add(`${fact.tx.toLowerCase()}:${fact.row.token_address?.toLowerCase()}`);
    }
  }

  for (const fact of facts) {
    if (fact.kind === "erc20") {
      const row = fact.row;
      const amount = BigInt(row.amount);
      const token = String(row.token_address ?? "").toLowerCase();
      const from = String(row.from_address ?? "").toLowerCase();
      const to = String(row.to_address ?? "").toLowerCase();

      const isInternalInterestMint =
        from === ZERO_ADDRESS &&
        to === normalizedAddress &&
        txTokenOutflows.has(`${fact.tx.toLowerCase()}:${token}`);

      if (to === normalizedAddress) {
        balances.set(token, (balances.get(token) ?? 0n) + amount);
        if (!isInternalInterestMint) {
          incoming.set(token, (incoming.get(token) ?? 0n) + amount);
        }
      }
      if (from === normalizedAddress) {
        balances.set(token, (balances.get(token) ?? 0n) - amount);
        outgoing.set(token, (outgoing.get(token) ?? 0n) + amount);
      }
    } else if (fact.kind === "tx") {
      const row = typeof fact.row.payload === "string" ? JSON.parse(fact.row.payload) : fact.row.payload;
      transactionCount++;
      if (row.from?.toLowerCase() === normalizedAddress) { const value = BigInt(row.value ?? "0"); nativeOut += value; nativeBalance -= value; }
      if (row.to?.toLowerCase() === normalizedAddress) { const value = BigInt(row.value ?? "0"); nativeIn += value; nativeBalance += value; }
    } else {
      const row = typeof fact.row.payload === "string" ? JSON.parse(fact.row.payload) : fact.row.payload;
      if (row.from?.toLowerCase() === normalizedAddress) { const value = BigInt(row.value ?? "0"); nativeOut += value; nativeBalance -= value; }
      if (row.to?.toLowerCase() === normalizedAddress) { const value = BigInt(row.value ?? "0"); nativeIn += value; nativeBalance += value; }
    }
  }
  for (const [token, amount] of balances) if (amount < 0n) warnings.push(`negative_balance:${token}`);
  return { balances: [...balances].map(([tokenAddress, amount]) => ({ tokenAddress, amount: amount.toString(), incoming: (incoming.get(tokenAddress) ?? 0n).toString(), outgoing: (outgoing.get(tokenAddress) ?? 0n).toString() })), nativeBalance: nativeBalance.toString(), nativeIn: nativeIn.toString(), nativeOut: nativeOut.toString(), transactionCount, warnings };
}

function decimalIndex(value: unknown): bigint { return typeof value === "string" && /^\d+$/.test(value) ? BigInt(value) : typeof value === "number" && Number.isSafeInteger(value) ? BigInt(value) : 0n; }
function compareFacts(a: Fact, b: Fact): number { if (a.block !== b.block) return a.block < b.block ? -1 : 1; const tx = a.tx.localeCompare(b.tx); if (tx !== 0) return tx; if (a.index !== b.index) return a.index < b.index ? -1 : 1; return a.identity.localeCompare(b.identity); }
interface HistoryCursor { block: string; transactionIndex?: string; logIndex?: string; identity: string; queryHash?: string; }
type CursorPage<T> = T[] & { nextCursor: string | null };
function encodeCursor(value: HistoryCursor): string { return Buffer.from(JSON.stringify(value), "utf8").toString("base64url"); }
function withNextCursor<T>(items: T[], nextCursor: string | null): CursorPage<T> { Object.defineProperty(items, "nextCursor", { value: nextCursor, enumerable: false, configurable: false }); return items as CursorPage<T>; }
function decodeCursor(value: string | undefined): HistoryCursor | null { if (value === undefined || value === "") return null; try { const decoded = Buffer.from(value, "base64url").toString("utf8"); const parsed = JSON.parse(decoded) as HistoryCursor; if (typeof parsed.block !== "string" || typeof parsed.identity !== "string") throw new Error("invalid"); return parsed; } catch (error) { throw new EvmDataError({ code: "INVALID_CURSOR", message: "The history cursor is invalid.", retryable: false, cause: error }); } }
function validateCursor(cursor: HistoryCursor | null, queryHash: string): void { if (cursor !== null && cursor.queryHash !== queryHash) throw new EvmDataError({ code: "INVALID_CURSOR", message: "The history cursor does not match this query.", retryable: false }); }
function historyQueryHash(value: readonly unknown[]): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24); }
function appendCursor(clauses: string[], params: unknown[], cursor: HistoryCursor | null): void { if (cursor === null) return; if (cursor.transactionIndex !== undefined || cursor.logIndex !== undefined) { clauses.push("(CAST(block_number AS INTEGER)>CAST(? AS INTEGER) OR (CAST(block_number AS INTEGER)=CAST(? AS INTEGER) AND (CAST(COALESCE(transaction_index,'0') AS INTEGER)>CAST(? AS INTEGER) OR (CAST(COALESCE(transaction_index,'0') AS INTEGER)=CAST(? AS INTEGER) AND (CAST(COALESCE(log_index,'0') AS INTEGER)>CAST(? AS INTEGER) OR (CAST(COALESCE(log_index,'0') AS INTEGER)=CAST(? AS INTEGER) AND identity>?))))))"); params.push(cursor.block, cursor.block, cursor.transactionIndex ?? "0", cursor.transactionIndex ?? "0", cursor.logIndex ?? "0", cursor.logIndex ?? "0", cursor.identity); return; } clauses.push("(CAST(block_number AS INTEGER)>CAST(? AS INTEGER) OR (CAST(block_number AS INTEGER)=CAST(? AS INTEGER) AND identity>?))"); params.push(cursor.block, cursor.block, cursor.identity); }
