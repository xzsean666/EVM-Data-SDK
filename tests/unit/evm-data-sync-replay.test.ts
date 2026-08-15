import { describe, expect, it } from "vitest";
import { SqliteStorageAdapter, PostgresStorageAdapter, normalizePostgresSql } from "../../src/storage/StorageAdapter";
import { SyncService } from "../../src/sync/SyncService";
import { HistoryService } from "../../src/history/HistoryService";
import { PriceSyncService } from "../../src/price/PriceSyncService";

const address = "0x1111111111111111111111111111111111111111";
const token = "0x2222222222222222222222222222222222222222";

function transfer(block: string, amount: string, incoming = true) {
  return { chainId: 1, transactionHash: `0x${block.padStart(64, "0")}`, transactionIndex: "0", logIndex: block, blockNumber: block, timestamp: null, tokenAddress: token, tokenName: null, tokenSymbol: "T", tokenDecimals: 18, from: incoming ? "0x0000000000000000000000000000000000000000" : address, to: incoming ? address : "0x0000000000000000000000000000000000000000", amount, provider: "etherscan" };
}

describe("persistent EVM sync and replay", () => {
  it("normalizes PostgreSQL upserts with nested values and positional parameters", () => {
    const normalized = normalizePostgresSql("INSERT OR REPLACE INTO sdk_replay_jobs(job_id,processed_events) VALUES(?,COALESCE((SELECT processed_events FROM sdk_replay_jobs WHERE job_id=?),0));").text;
    expect(normalized).toContain("INSERT INTO sdk_replay_jobs");
    expect(normalized).toContain("ON CONFLICT DO UPDATE SET job_id=EXCLUDED.job_id,processed_events=EXCLUDED.processed_events;");
    expect(normalized).toContain("VALUES($1,COALESCE((SELECT processed_events FROM sdk_replay_jobs WHERE job_id=$2),0))");
  });

  it("commits facts and cursor idempotently, then replays balances", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize();
    expect(storage.all<{ version: number }>("SELECT version FROM sdk_schema_migrations ORDER BY version").map((row) => row.version)).toEqual([1, 2, 3]);
    const items = [transfer("10", "90071992547409931234567890"), transfer("11", "2", false)];
    const fake = { token: { getErc20TransfersByBlockRange: async () => ({ items, range: { startBlock: "10", endBlock: "11" }, providers: ["etherscan"], stats: {} }) }, address: {}, chain: { getLatestBlockNumber: async () => ({ blockNumber: "11" }) } } as any;
    const sync = new SyncService({ storage, token: fake.token, address: fake.address, chain: fake.chain, resolveChain: () => ({ chainId: 1 }) });
    const result = await sync.update({ chain: "ethereum", address, dataset: "erc20", fromBlock: "10", toBlock: "11", replay: true });
    expect(result.nextBlock).toBe("12"); expect(result.recordsWritten).toBe(2); expect(result.hasNext).toBe(false);
    const duplicate = storage.all("SELECT identity FROM sdk_erc20_transfers"); expect(duplicate).toHaveLength(2);
    const second = await sync.recollect({ chain: "ethereum", address, dataset: "erc20", fromBlock: "10", toBlock: "11", strategy: "merge" });
    expect(second.recordsWritten).toBe(0); expect(second.duplicates).toBe(2);
    const history = new HistoryService({ storage, resolveChain: () => ({ chainId: 1 }), snapshotEveryEvents: 1 }); await history.replay({ chain: "ethereum", address });
    const state = await history.getUserStateAtBlock({ chain: "ethereum", address, blockNumber: "11" });
    expect(state.state).toBe("ready"); expect(state.balances[0]?.amount).toBe("90071992547409931234567888");
    await storage.close();
  });

  it("uses deterministic field hashes when provider identities omit log or trace indexes", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize();
    const first = { ...transfer("10", "1"), logIndex: null };
    const second = { ...transfer("10", "2", false), logIndex: null };
    const fake = { token: { getErc20TransfersByBlockRange: async () => ({ items: [first, second], range: { startBlock: "10", endBlock: "10" }, providers: ["etherscan"] }) }, address: {}, chain: {} } as any;
    const sync = new SyncService({ storage, token: fake.token, address: fake.address, chain: fake.chain, resolveChain: () => ({ chainId: 1 }) });
    await sync.update({ chain: "ethereum", address, dataset: "erc20", fromBlock: "10", toBlock: "10" });
    expect(storage.all("SELECT identity FROM sdk_erc20_transfers")).toHaveLength(2);
    await storage.close();
  });

  it("provides stable history cursors after applying filters in SQL", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize();
    for (const [block, amount] of [[10, "1"], [11, "2"]] as const) {
      const row = transfer(String(block), amount); storage.run("INSERT INTO sdk_erc20_transfers(identity,chain_id,address,token_address,tx_hash,transaction_index,log_index,block_number,timestamp,token_name,token_symbol,token_decimals,from_address,to_address,amount,provider,ingestion_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [`cursor-${block}`, 1, address, token, row.transactionHash, "0", String(block), String(block), null, null, "T", 18, row.from, row.to, amount, "etherscan", "sdk"]);
    }
    const history = new HistoryService({ storage, resolveChain: () => ({ chainId: 1 }) });
    const first = await history.getTokenFlowHistory({ chain: "ethereum", address, startBlock: "10", endBlock: "11", limit: 1 });
    const second = await history.getTokenFlowHistory({ chain: "ethereum", address, startBlock: "10", endBlock: "11", limit: 1, cursor: first.nextCursor! });
    expect(first).toHaveLength(1); expect(first.nextCursor).toBeTypeOf("string"); expect(second).toHaveLength(1); expect(second[0]?.amount).toBe("2");
    await storage.close();
  });

  it("publishes snapshots only at complete block boundaries", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize();
    for (const [block, amount] of [[1, "1"], [2, "2"], [2, "3"]] as const) {
      const row = transfer(String(block), amount); storage.run("INSERT INTO sdk_erc20_transfers(identity,chain_id,address,token_address,tx_hash,transaction_index,log_index,block_number,timestamp,token_name,token_symbol,token_decimals,from_address,to_address,amount,provider,ingestion_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [`${block}-${amount}`, 1, address, token, row.transactionHash, "0", String(amount), String(block), null, null, "T", 18, row.from, row.to, amount, "etherscan", "sdk"]);
    }
    const history = new HistoryService({ storage, resolveChain: () => ({ chainId: 1 }), snapshotEveryEvents: 1, snapshotEveryBlocks: 100 }); await history.replay({ chain: "ethereum", address });
    expect(storage.all("SELECT block_number FROM sdk_user_state_snapshots")).toHaveLength(2);
    await storage.close();
  });

  it("resumes non-forced replay after the latest same-revision snapshot", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize();
    for (const block of [1, 2] as const) {
      const row = transfer(String(block), "1"); storage.run("INSERT INTO sdk_erc20_transfers(identity,chain_id,address,token_address,tx_hash,transaction_index,log_index,block_number,timestamp,token_name,token_symbol,token_decimals,from_address,to_address,amount,provider,ingestion_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [`resume-${block}`, 1, address, token, row.transactionHash, "0", String(block), String(block), null, null, "T", 18, row.from, row.to, "1", "etherscan", "sdk"]);
    }
    const history = new HistoryService({ storage, resolveChain: () => ({ chainId: 1 }), snapshotEveryEvents: 1 });
    const first = await history.replay({ chain: "ethereum", address });
    const row = transfer("3", "1"); storage.run("INSERT INTO sdk_erc20_transfers(identity,chain_id,address,token_address,tx_hash,transaction_index,log_index,block_number,timestamp,token_name,token_symbol,token_decimals,from_address,to_address,amount,provider,ingestion_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ["resume-3", 1, address, token, row.transactionHash, "0", "3", "3", null, null, "T", 18, row.from, row.to, "1", "etherscan", "sdk"]);
    const second = await history.replay({ chain: "ethereum", address });
    expect(second.revision).toBe(first.revision);
    expect(storage.all("SELECT block_number FROM sdk_user_state_snapshots WHERE revision=?", [first.revision])).toHaveLength(3);
    expect(storage.get<any>("SELECT processed_events FROM sdk_replay_jobs WHERE job_id=?", [second.jobId])?.processed_events).toBe(1);
    await storage.close();
  });

  it("dry-run recollect does not delete or advance persisted facts", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize();
    const existing = transfer("10", "1"); storage.run("INSERT INTO sdk_erc20_transfers(identity,chain_id,address,token_address,tx_hash,transaction_index,log_index,block_number,timestamp,token_name,token_symbol,token_decimals,from_address,to_address,amount,provider,ingestion_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ["existing", 1, address, token, existing.transactionHash, "0", "10", "10", null, null, "T", 18, existing.from, existing.to, "1", "etherscan", "sdk"]);
    const fake = { token: { getErc20TransfersByBlockRange: async () => ({ items: [transfer("10", "2")], range: { startBlock: "10", endBlock: "10" }, providers: ["etherscan"] }) }, address: {}, chain: {} } as any;
    const sync = new SyncService({ storage, token: fake.token, address: fake.address, chain: fake.chain, resolveChain: () => ({ chainId: 1 }) });
    const result = await sync.recollect({ chain: "ethereum", address, dataset: "erc20", fromBlock: "10", toBlock: "10", dryRun: true });
    expect(result.dryRun).toBe(true); expect(storage.all("SELECT identity FROM sdk_erc20_transfers")).toHaveLength(1); expect(storage.get("SELECT * FROM sdk_sync_scopes")).toBeUndefined();
    await storage.close();
  });

  it("recollect replace writes the replacement and persists its cursor atomically", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize();
    const fake = { token: { getErc20TransfersByBlockRange: async () => ({ items: [transfer("20", "7")], range: { startBlock: "20", endBlock: "20" }, providers: ["etherscan"] }) }, address: {}, chain: {} } as any;
    const sync = new SyncService({ storage, token: fake.token, address: fake.address, chain: fake.chain, resolveChain: () => ({ chainId: 1 }) });
    const result = await sync.recollect({ chain: "ethereum", address, dataset: "erc20", fromBlock: "20", toBlock: "20", strategy: "replace" });
    expect(result.recordsWritten).toBe(1); expect(storage.get<any>("SELECT next_block FROM sdk_sync_scopes WHERE scope_key=?", ["1:" + address + ":erc20"])?.next_block).toBe("21");
    await storage.close();
  });

  it("limits an update to one configured block window", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize(); let requested: unknown[] = [];
    const fake = { token: { getErc20TransfersByBlockRange: async (request: any) => { requested = [request.startBlock, request.endBlock]; return { items: [], range: { startBlock: request.startBlock, endBlock: request.endBlock }, providers: ["etherscan"] }; } }, address: {}, chain: {} } as any;
    const sync = new SyncService({ storage, token: fake.token, address: fake.address, chain: fake.chain, maxWindowBlocks: 2, resolveChain: () => ({ chainId: 1 }) });
    const result = await sync.update({ chain: "ethereum", address, dataset: "erc20", fromBlock: "10", toBlock: "15" });
    expect(requested).toEqual(["10", "11"]); expect(result.targetBlock).toBe("15"); expect(result.nextBlock).toBe("12"); expect(result.hasNext).toBe(true);
    await storage.close();
  });

  it("honors a per-request maxBlocks limit", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize(); let requested: unknown[] = [];
    const fake = { token: { getErc20TransfersByBlockRange: async (request: any) => { requested = [request.startBlock, request.endBlock]; return { items: [], range: { startBlock: request.startBlock, endBlock: request.endBlock }, providers: ["etherscan"] }; } }, address: {}, chain: {} } as any;
    const sync = new SyncService({ storage, token: fake.token, address: fake.address, chain: fake.chain, maxWindowBlocks: 100, resolveChain: () => ({ chainId: 1 }) });
    await sync.update({ chain: "ethereum", address, dataset: "erc20", fromBlock: "10", toBlock: "20", maxBlocks: "3" });
    expect(requested).toEqual(["10", "12"]);
    await storage.close();
  });

  it("records a failed run without advancing the cursor", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize();
    const fake = { token: { getErc20TransfersByBlockRange: async () => { throw new Error("provider failed"); } }, address: {}, chain: {} } as any;
    const sync = new SyncService({ storage, token: fake.token, address: fake.address, chain: fake.chain, resolveChain: () => ({ chainId: 1 }) });
    await expect(sync.update({ chain: "ethereum", address, dataset: "erc20", fromBlock: "10", toBlock: "10" })).rejects.toBeTruthy();
    expect(storage.get<any>("SELECT next_block FROM sdk_sync_scopes WHERE scope_key=?", ["1:" + address + ":erc20"])?.next_block).toBe("10");
    expect(storage.get<any>("SELECT status,error_code FROM sdk_sync_runs")?.status).toBe("failed");
    await storage.close();
  });

  it("recollects a persisted overlap without moving the cursor backward", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize(); const requests: string[][] = [];
    const fake = { token: { getErc20TransfersByBlockRange: async (request: any) => { requests.push([request.startBlock, request.endBlock]); return { items: [], range: { startBlock: request.startBlock, endBlock: request.endBlock }, providers: ["etherscan"] }; } }, address: {}, chain: {} } as any;
    const sync = new SyncService({ storage, token: fake.token, address: fake.address, chain: fake.chain, maxWindowBlocks: 5, reorgOverlapBlocks: 2, resolveChain: () => ({ chainId: 1 }) });
    await sync.update({ chain: "ethereum", address, dataset: "erc20", fromBlock: "10", toBlock: "14" });
    await sync.update({ chain: "ethereum", address, dataset: "erc20", toBlock: "20" });
    expect(requests[1]).toEqual(["13", "17"]); expect(storage.get<any>("SELECT next_block FROM sdk_sync_scopes WHERE scope_key=?", ["1:" + address + ":erc20"])?.next_block).toBe("18");
    await sync.update({ chain: "ethereum", address, dataset: "erc20", toBlock: "17" });
    expect(requests).toHaveLength(2);
    await storage.close();
  });

  it("does not move a completed cursor backward during recollect", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize();
    const fake = { token: { getErc20TransfersByBlockRange: async (request: any) => ({ items: [], range: { startBlock: request.startBlock, endBlock: request.endBlock }, providers: ["etherscan"] }) }, address: {}, chain: {} } as any;
    const sync = new SyncService({ storage, token: fake.token, address: fake.address, chain: fake.chain, resolveChain: () => ({ chainId: 1 }) });
    await sync.update({ chain: "ethereum", address, dataset: "erc20", fromBlock: "10", toBlock: "20" });
    await sync.recollect({ chain: "ethereum", address, dataset: "erc20", fromBlock: "12", toBlock: "13", strategy: "merge" });
    expect(storage.get<any>("SELECT next_block FROM sdk_sync_scopes WHERE scope_key=?", ["1:" + address + ":erc20"])?.next_block).toBe("21");
    await storage.close();
  });

  it("replaces SDK facts in the reorg overlap while preserving other sources", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize();
    const old = transfer("10", "1");
    storage.run("INSERT INTO sdk_erc20_transfers(identity,chain_id,address,token_address,tx_hash,transaction_index,log_index,block_number,timestamp,token_name,token_symbol,token_decimals,from_address,to_address,amount,provider,ingestion_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ["old", 1, address, token, old.transactionHash, "0", "10", "10", null, null, "T", 18, old.from, old.to, "1", "old", "sdk"]);
    storage.run("INSERT INTO sdk_erc20_transfers(identity,chain_id,address,token_address,tx_hash,transaction_index,log_index,block_number,timestamp,token_name,token_symbol,token_decimals,from_address,to_address,amount,provider,ingestion_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", ["external", 1, address, token, old.transactionHash, "0", "11", "10", null, null, "T", 18, old.from, old.to, "2", "other", "external"]);
    storage.run("INSERT INTO sdk_sync_scopes(scope_key,chain_id,address,dataset,next_block,target_block,last_complete_block,status,updated_at) VALUES(?,?,?,?,?,?,?,?,?)", ["1:" + address + ":erc20", 1, address, "erc20", "11", "20", "10", "idle", new Date().toISOString()]);
    const fake = { token: { getErc20TransfersByBlockRange: async () => ({ items: [transfer("10", "3")], range: { startBlock: "9", endBlock: "12" }, providers: ["etherscan"] }) }, address: {}, chain: {} } as any;
    const sync = new SyncService({ storage, token: fake.token, address: fake.address, chain: fake.chain, reorgOverlapBlocks: 2, resolveChain: () => ({ chainId: 1 }) });
    await sync.update({ chain: "ethereum", address, dataset: "erc20", toBlock: "12" });
    const rows = storage.all<any>("SELECT ingestion_source,amount FROM sdk_erc20_transfers WHERE chain_id=1 AND address=? ORDER BY ingestion_source", [address]);
    expect(rows).toContainEqual({ ingestion_source: "external", amount: "2" });
    expect(rows).toContainEqual({ ingestion_source: "sdk", amount: "3" });
    expect(rows).not.toContainEqual({ ingestion_source: "sdk", amount: "1" });
    await storage.close();
  });

  it("coalesces an active replay lease instead of starting a second job", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize();
    storage.run("INSERT INTO sdk_replay_jobs(job_id,chain_id,address,from_block,to_block,status,facts_revision,updated_at,processed_events,lease_owner,lease_until,heartbeat_at,attempts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", ["running", 1, address, "1", "10", "running", "rev", new Date().toISOString(), 0, "owner", new Date(Date.now() + 60_000).toISOString(), new Date().toISOString(), 1]);
    const history = new HistoryService({ storage, resolveChain: () => ({ chainId: 1 }) });
    const result = await history.replay({ chain: "ethereum", address });
    expect(result.status).toBe("busy"); expect(result.jobId).toBe("running"); expect(result.revision).toBe("rev"); expect(storage.get<any>("SELECT from_block,to_block FROM sdk_replay_jobs WHERE job_id=?", ["running"])).toMatchObject({ from_block: "0", to_block: "10" });
    await storage.close();
  });

  it("recovers an expired replay lease without leaving two running jobs", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize();
    storage.run("INSERT INTO sdk_replay_jobs(job_id,chain_id,address,from_block,to_block,status,facts_revision,updated_at,processed_events,lease_owner,lease_until,heartbeat_at,attempts) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", ["stale", 1, address, "1", "10", "running", "old", new Date(0).toISOString(), 0, "owner", new Date(0).toISOString(), new Date(0).toISOString(), 1]);
    const history = new HistoryService({ storage, resolveChain: () => ({ chainId: 1 }) });
    const result = await history.replay({ chain: "ethereum", address });
    expect(result.status).toBe("completed");
    expect(storage.all<{ status: string }>("SELECT status FROM sdk_replay_jobs WHERE status='running'")).toHaveLength(0);
    await storage.close();
  });

  it("keeps PostgreSQL storage errors typed before initialization", async () => {
    const storage = new PostgresStorageAdapter("postgresql://user:password@localhost:1/evm");
    await expect(storage.get("SELECT 1")).rejects.toMatchObject({ code: "STORAGE_NOT_INITIALIZED" });
    await storage.close();
  });

  it("price nearest lookup uses earlier point on an equal-distance tie", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize();
    const fakeBinance = { getFiveMinuteKlines: async () => [{ timestamp: Date.parse("2026-01-01T00:00:00.000Z"), priceUsd: "10" }, { timestamp: Date.parse("2026-01-01T00:10:00.000Z"), priceUsd: "12" }] } as any;
    const price = new PriceSyncService(storage, fakeBinance);
    await price.update({ token: "ETH", exchange: "binance", market: "ETHUSDT", interval: "5m", fromTimestamp: "2026-01-01T00:00:00.000Z", toTimestamp: "2026-01-01T00:20:00.000Z" });
    const result = await price.getPriceAt({ token: "ETH", exchange: "binance", market: "ETHUSDT", interval: "5m", timestamp: "2026-01-01T00:05:00.000Z" });
    expect(result.status).toBe("priced"); expect(result.price).toBe("10");
    expect((await price.getPriceAt({ token: "ETH", exchange: "binance", market: "ETHUSDT", interval: "5m", timestamp: "2026-01-01T00:05:00.000Z", maxDistanceMs: "1000" })).status).toBe("missing");
    await storage.close();
  });

  it("continues a price scope when fromTimestamp is omitted", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize();
    const fakeBinance = { getFiveMinuteKlines: async (_market: string, start: number, end: number) => [{ timestamp: start, priceUsd: "10" }] } as any;
    const price = new PriceSyncService(storage, fakeBinance);
    const first = await price.update({ token: "ETH", exchange: "binance", market: "ETHUSDT", interval: "5m", fromTimestamp: "2026-01-01T00:00:00.000Z", toTimestamp: "2026-01-01T00:10:00.000Z" });
    const second = await price.update({ token: "ETH", exchange: "binance", market: "ETHUSDT", interval: "5m", toTimestamp: "2026-01-01T00:20:00.000Z" });
    expect(first.nextFromTimestamp).toBe("2026-01-01T00:05:00.000Z");
    expect(second.fromTimestamp).toBe("2026-01-01T00:05:00.000Z");
    await storage.close();
  });

  it("uses configured daily price adapters for non-Binance exchanges", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize();
    const fakeBinance = { getFiveMinuteKlines: async () => [] } as any;
    const daily = { name: "coinbase", supports: () => true, getPriceHistory: async () => ({ provider: "coinbase", status: "success", token: { input: "ETH", normalized: "eth", symbol: "ETH", name: null }, market: { product: "ETH-USD", quoteAsset: "USD", sourceKind: "exchange", network: null, tokenAddress: null, poolAddress: null }, interval: "1d", timezone: "UTC", requestedRange: { kind: "between", startDate: "2026-01-01", endDate: "2026-01-01" }, points: [{ date: "2026-01-01", timestamp: "2026-01-01T00:00:00.000Z", open: "1", high: "1", low: "1", close: "1", price: "1", volume: null, isFinal: true }], missingDates: [] }) } as any;
    const price = new PriceSyncService(storage, fakeBinance, {}, new Map([["coinbase", daily]]));
    const result = await price.update({ token: "ETH", exchange: "coinbase", market: "ETH-USD", interval: "1d", fromTimestamp: "2026-01-01T00:00:00.000Z", toTimestamp: "2026-01-02T00:00:00.000Z" });
    expect(result.provider).toBe("coinbase"); expect(result.recordsWritten).toBe(1);
    await storage.close();
  });

  it("synthesizes WETH deposit and withdrawal facts from transaction payloads", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize();
    const wethAddress = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
    const depositPayload = JSON.stringify({ hash: "0x1111", blockNumber: "100", from: address, to: wethAddress, value: "1803965000000000000", input: "0xd0e30db0" });
    const withdrawPayload = JSON.stringify({ hash: "0x2222", blockNumber: "101", from: address, to: wethAddress, value: "0", input: "0x2e1a7d4d0000000000000000000000000000000000000000000000001908f89c143cd000" }); // 1.803965 ETH in hex

    await storage.run("INSERT INTO sdk_transactions(identity,chain_id,address,tx_hash,block_number,payload,provider,ingestion_source) VALUES(?,?,?,?,?,?,?,?)", ["tx-1", 1, address, "0x1111", "100", depositPayload, "etherscan", "sdk"]);
    await storage.run("INSERT INTO sdk_transactions(identity,chain_id,address,tx_hash,block_number,payload,provider,ingestion_source) VALUES(?,?,?,?,?,?,?,?)", ["tx-2", 1, address, "0x2222", "101", withdrawPayload, "etherscan", "sdk"]);

    const history = new HistoryService({ storage, resolveChain: () => ({ chainId: 1 }) });
    await history.replay({ chain: "ethereum", address });

    const atDeposit = await history.getUserStateAtBlock({ chain: "ethereum", address, blockNumber: "100" });
    expect(atDeposit.balances.find((b) => b.tokenAddress.toLowerCase() === wethAddress)?.amount).toBe("1803965000000000000");
    expect(atDeposit.nativeOut).toBe("1803965000000000000");

    const atWithdraw = await history.getUserStateAtBlock({ chain: "ethereum", address, blockNumber: "101" });
    expect(atWithdraw.balances.find((b) => b.tokenAddress.toLowerCase() === wethAddress)?.amount).toBe("0");
    expect(atWithdraw.warnings).toHaveLength(0);
    await storage.close();
  });

  it("filters internal 0x0 interest settlement mints accompanying Rebasing token withdrawals", async () => {
    const storage = new SqliteStorageAdapter(":memory:"); await storage.initialize();
    const aToken = "0x4d5f47fa6a74757f35c14fd3a6ef8e3c9bc514e8";
    const zeroAddr = "0x0000000000000000000000000000000000000000";

    // Initial deposit: mint 1.0 aToken
    await storage.run("INSERT INTO sdk_erc20_transfers(identity,chain_id,address,token_address,tx_hash,transaction_index,log_index,block_number,from_address,to_address,amount,provider,ingestion_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", ["mint-1", 1, address, aToken, "0xaaaa", "0", "1", "10", zeroAddr, address, "1000000000000000000", "etherscan", "sdk"]);

    // Withdrawal tx: 0x0 interest settlement 0.05 aToken + burn 1.05 aToken in the same tx
    await storage.run("INSERT INTO sdk_erc20_transfers(identity,chain_id,address,token_address,tx_hash,transaction_index,log_index,block_number,from_address,to_address,amount,provider,ingestion_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", ["interest-mint", 1, address, aToken, "0xbbbb", "0", "1", "20", zeroAddr, address, "50000000000000000", "etherscan", "sdk"]);
    await storage.run("INSERT INTO sdk_erc20_transfers(identity,chain_id,address,token_address,tx_hash,transaction_index,log_index,block_number,from_address,to_address,amount,provider,ingestion_source) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", ["burn-all", 1, address, aToken, "0xbbbb", "0", "2", "20", address, zeroAddr, "1050000000000000000", "etherscan", "sdk"]);

    const history = new HistoryService({ storage, resolveChain: () => ({ chainId: 1 }) });
    await history.replay({ chain: "ethereum", address });

    const state = await history.getUserStateAtBlock({ chain: "ethereum", address, blockNumber: "20" });
    const holding = state.balances.find((b) => b.tokenAddress.toLowerCase() === aToken);

    // Initial incoming 1.0, 0x0 internal interest mint in withdrawal tx is ignored from external incoming, total outgoing = 1.05
    expect(holding?.incoming).toBe("1000000000000000000");
    expect(holding?.outgoing).toBe("1050000000000000000");
    await storage.close();
  });
});
