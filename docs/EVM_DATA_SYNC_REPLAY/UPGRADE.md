# EVM Data SDK 持久化采集与历史回放升级说明

状态：已实现持久化同步、价格同步、历史查询、SQLite/PostgreSQL storage adapter；PostgreSQL live contract、完整 provider 边界与并发 contract tests 待补齐。

目标：把当前无状态的 EVM 数据读取 SDK 升级为可以使用 SQLite 或 PostgreSQL
持久化事实数据、按区块/时间范围反复增量采集、并按用户和区块重建历史状态的
可复用工具。

本目录的三份文档分别是：

- `UPGRADE.md`：产品行为、架构、数据契约和验收标准；
- `TASK_BREAKDOWN.md`：交给实现模型的有序任务拆分；
- `AI_IMPLEMENTATION_PROMPT.md`：可以直接复制给 Claude Sonnet 5 或
  ChatGPT Terra 的实现提示词。

## 1. 基线与差异

当前仓库的公开架构是无状态读取 SDK：`EvmDataClient` 组合 provider、执行器、
价格聚合器和区块范围读取 API；`Transaction`、`Erc20Transfer`、
`InternalNativeTransfer` 以及 `onWindow` 范围窗口模型已经存在。当前仓库的
`ClientConfiguration` 中尚未看到数据库 URL、迁移器或持久化同步服务。

需求描述假定 SDK 已经可以传入 PostgreSQL URL 或 SQLite 地址，省略时使用
`./data/evm-data-sdk.db`。本升级将这一点作为目标兼容契约；实现模型必须先核对
当前分支，如果基线确实不存在，就补齐它而不是假设它已经存在。不能用文档掩盖
基线差异。

后端参考实现是：

`/home/sean/ems/astarfi/astar-fi-backend`

需要重点参考但不能直接复制 NestJS/TypeORM 代码的文件包括：

- `src/token-tracking/evm-data-sdk.service.ts`：将 provider page 转为按区块推进的
  page，返回 `coveredEndBlock` 和 `needsBlockRetry`，并处理单区块超过 provider
  限制的情况；
- `src/token-tracking/evm-historical-backfill.worker.ts`：固定最终目标区块、按数据集
  保存 `nextBlock`/`lastCompleteBlock`、租约、心跳、重试和一个完整窗口一个事务；
- `src/token-tracking/evm-data-sync.coordinator.ts`：重叠区块刷新、事实 upsert、游标
  与事实同事务提交、重放起点回退；
- `src/token-tracking/historical-price-collector.service.ts`、
  `historical-token-price.service.ts` 和 `token-price-1m.repository.ts`：价格按时间/区块
  采集、数据库租约、幂等写入和附近时间查询；
- `src/database/entities/core.entity.ts`：`token_transfer_records`、
  `user_chain_sync_cursors`、`evm_historical_backfill_jobs`、
  `evm_historical_backfill_datasets` 等表的字段、唯一键和索引；
- `src/token-tracking/action-parser.service.ts`：事实数据转换为用户历史动作的边界。

## 2. 目标与非目标

### 2.1 目标

1. SDK 初始化时支持 PostgreSQL 和 SQLite；默认 SQLite 文件为
   `./data/evm-data-sdk.db`，首次使用自动创建父目录并执行版本化迁移。
2. `tokentx`、`txlist`、`txlistinternal` 都以用户地址和区块范围为单位采集；一次
   `update` 只完成一个有界窗口并落库，调用方通过重复调用推进，绝不把 provider 的
   page token/page number 当成业务游标。
3. 每次 update 返回 `hasNext`、实际覆盖区块、记录统计、持久化游标和可观察的状态。
   网络失败或进程退出后重试同一个窗口不会产生重复事实，也不会跳过区块。
4. 价格采集支持 token 名称/符号/地址、交易所、交易对、时间区间和 K 线间隔；每次
   update 只向指定交易所请求它单次允许的最大数量，时间范围和数据库进度控制下一次
   请求。
5. 价格查询支持一个 timestamp 附近的价格，以及同一批次多个 token/timestamp 的
   查询；缺失、距离过远和来源歧义必须显式返回。
6. update 可选择触发用户历史回放。回放期间 update 不重复启动第二个回放，而是返回
   `history_replay_running`/`history_replay_queued` 等状态；回放完成后提供区块级用户
   状态和 token 转入/转出历史查询。
7. 回放使用不可变事实、版本化派生状态和按事件数/区块边界的快照，查询任意历史区块
   时从最近快照重放，而不是从创世区块重复计算。
8. PostgreSQL 和 SQLite 对外行为一致；所有链上数量、区块、时间戳在公共模型中为
   十进制字符串，禁止 JavaScript `number` 造成精度损失。

### 2.2 非目标

- 不在 SDK 内自动轮询、自动调度或偷偷创建后台 worker；update 由调用方控制。
- 不把 API 的 page cursor/page number 持久化为业务状态，也不依赖“最后一页”判断
  是否完成。
- 不承诺 provider 能返回未经索引的数据，不在 SDK 内伪造 token balance 或价格。
- 不在本阶段实现完整 DeFi 协议动作解析、税务/PnL、NFT、trace 全图或链重组共识；
  这些可以消费已经保存的事实数据另行扩展。
- 不保存 API key、Authorization、代理 URL、完整上游请求 URL 或原始错误中的秘密。

## 3. 配置和生命周期

目标配置形状如下，具体命名可以在实现阶段与现有配置风格对齐，但语义必须保持：

```ts
interface StorageConfiguration {
  /** PostgreSQL URL, sqlite:// URL, 或兼容的 SQLite 文件地址。 */
  readonly url?: string;
  readonly autoMigrate?: boolean;
  readonly busyTimeoutMs?: number;
}

interface ClientConfiguration {
  readonly storage?: StorageConfiguration;
  readonly sync?: {
    readonly finalityConfirmations?: number;
    readonly reorgOverlapBlocks?: string;
    readonly maxRecordsPerWrite?: number;
    readonly replay?: ReplayConfiguration;
  };
}
```

解析规则：

- `postgres://` 和 `postgresql://` 解析为 PostgreSQL；URL 中的密码只能用于连接，
  不得出现在错误、日志、cursor、telemetry 或结果中；
- `sqlite:///absolute/path.db`、`sqlite:./relative/path.db` 和实现已经支持的
  SQLite 文件地址解析为 SQLite；相对路径相对于进程工作目录；
- 没有 `storage.url` 时使用 `sqlite:./data/evm-data-sdk.db`；不能因为目录不存在
  而失败，目录创建必须是幂等的；
- 构造函数只解析配置和建立惰性句柄，不做网络请求和迁移以外的业务工作；
  `await client.initialize()` 打开数据库、取得迁移锁、完成迁移并初始化 provider；
- `await client.close()` 必须停止新写入、释放租约、关闭数据库和已有运行时资源；
  重复 close 是安全的；未 initialize 的纯读取 client 仍保留原有兼容行为，持久化
  update/历史查询必须给出清楚的 `STORAGE_NOT_INITIALIZED`。

SQLite 与 PostgreSQL 的迁移版本必须相同。实现可以使用数据库适配层、Kysely 或
其它方案，但不能让业务层散落方言 SQL。若新增依赖，先按 `Agent.md` 的要求记录
官方文档、版本、理由和约束；默认 SQLite 不能要求用户额外启动数据库服务。

## 4. 公共 API 契约

下面是推荐的职责边界。现有的 `address`/`token` 无状态读取方法继续保留；新增
`sync`、`price` 和 `history` 命名空间。若实现选择其它命名，必须提供等价的职责
和类型，不得把所有功能塞进一个 `manager`。

### 4.1 价格 update

```ts
type PriceExchange = "binance" | "okx" | "coinbase" | "geckoterminal" | string;

interface UpdatePriceRequest {
  readonly token: string;
  readonly exchange: PriceExchange;
  readonly market?: string;
  readonly quoteCurrency?: string;
  readonly interval?: "1m" | "5m" | "15m" | "1h" | "1d";
  /** ISO timestamp 或十进制毫秒字符串；范围为 [from, to)。 */
  readonly fromTimestamp?: string | Date;
  readonly toTimestamp?: string | Date;
  readonly signal?: AbortSignal;
}

interface PriceUpdateResult {
  readonly status: "completed" | "partial" | "busy" | "failed";
  readonly tokenKey: string;
  readonly exchange: string;
  readonly interval: string;
  readonly requestedRange: { fromTimestamp: string; toTimestamp: string };
  readonly coveredRange: { fromTimestamp: string; toTimestamp: string } | null;
  readonly nextFromTimestamp: string | null;
  readonly recordsSeen: number;
  readonly recordsWritten: number;
  readonly hasNext: boolean;
  readonly runId: string;
  readonly errorCode?: string;
}
```

行为要求：

1. `token` 必须解析为稳定的 token key。地址优先；仅有 symbol/name 时必须经过
   明确 alias/market 配置，遇到多个交易对不能猜选，返回 `TOKEN_AMBIGUOUS`。
2. 第一次调用提供 `fromTimestamp` 时创建 `(tokenKey, exchange, market, interval,
   quoteCurrency)` 的同步 scope；后续省略 `fromTimestamp` 就从数据库的
   `nextFromTimestamp` 继续。显式传入不一致的起点必须报 scope 冲突，而不是默默
   重置数据；需要重置时使用明确的 `resetPriceSync`。
3. `toTimestamp` 省略时取一次当前时间并固定到本次 run；不能在一个 run 内边采边移动
   目标。每次 scope 追上目标后，下一个 update 可以重新解析新的当前目标。
4. adapter 以时间范围请求单个交易所一次，数量上限使用该交易所真实的最大限制；
   不持久化它的 page token。若 provider 只有 page API，adapter 必须把它包装为有界
   时间窗口并在本次 update 内返回明确的覆盖边界，不能把 page 当作 SDK 进度。
5. 以最后一个有效 candle 的时间加 interval 推进 `nextFromTimestamp`；即使返回空窗，
   也必须有可验证的 `coveredRange` 或返回 `PROVIDER_STALLED`，避免无限循环。
6. points 按 `(tokenKey, exchange, market, interval, timestamp)` 幂等 upsert；同一
   时间点修订时保留最新合法值和 `fetchedAt`，不重复计数。一个 update 的事实写入、
   progress 和 run 状态必须在同一事务中提交。
7. `hasNext` 只表示数据库进度尚未覆盖本次固定的 `toTimestamp`，不表示 provider
   page 是否存在。调用方应在 `hasNext === true` 时再次调用 update，并通常省略
   `fromTimestamp`。

### 4.2 价格查询

```ts
interface GetPriceAtRequest {
  readonly token: string;
  readonly exchange?: PriceExchange;
  readonly market?: string;
  readonly interval?: string;
  readonly timestamp: string | Date;
  readonly maxDistanceMs?: string;
  readonly direction?: "before" | "after" | "nearest";
}

interface PriceAtResult {
  readonly state: "priced" | "missing" | "unsupported" | "ambiguous";
  readonly tokenKey: string;
  readonly requestedTimestamp: string;
  readonly price: string | null;
  readonly priceTimestamp: string | null;
  readonly distanceMs: string | null;
  readonly exchange: string | null;
  readonly market: string | null;
  readonly quoteCurrency: string | null;
}
```

`getPriceAt` 默认使用 `direction: "nearest"`：前后都有点时选择绝对距离最小，距离
相同选择较早点；调用方可以明确指定 `before` 或 `after`。超过 `maxDistanceMs` 返回
`missing`，不能用零或任意旧价格填充。批量方法 `getPricesAt` 接受多个 request，在
数据库内分组，返回与输入一一对应的结果，并报告每项状态，不因一项缺失而丢失整批。

### 4.3 三类链上 update

```ts
type SyncDataset = "erc20" | "transactions" | "internal_native";

interface UpdateUserDatasetRequest {
  readonly chain: ChainReference;
  readonly address: string;
  readonly dataset: SyncDataset;
  readonly fromBlock?: string;
  readonly toBlock?: string;
  readonly maxBlocks?: string;
  readonly replay?: boolean;
  readonly signal?: AbortSignal;
}

interface DatasetUpdateResult {
  readonly status:
    | "completed"
    | "partial"
    | "busy"
    | "history_replay_queued"
    | "history_replay_running"
    | "failed";
  readonly dataset: SyncDataset;
  readonly chainId: number;
  readonly address: string;
  readonly targetBlock: string;
  readonly requestedRange: BlockRange;
  readonly coveredRange: BlockRange | null;
  readonly nextBlock: string;
  readonly hasNext: boolean;
  readonly recordsSeen: number;
  readonly recordsWritten: number;
  readonly duplicateRecords: number;
  readonly provider: string | null;
  readonly runId: string;
  readonly replay: ReplayStatus;
  readonly errorCode?: string;
}
```

三类 update 的共同规则：

- scope 主键是 `(chainId, normalizedAddress, dataset)`；首次调用可以指定
  `fromBlock`，否则从 scope 的 `nextBlock` 开始；`toBlock` 省略时读取一次已确认的
  provider head 并固定为本次目标；
- `targetBlock`、`nextBlock` 和 `lastCompleteBlock` 是 SDK 自己的业务状态；provider
  cursor 永远只存在于当前网络请求栈；
- 请求使用闭区间 `[startBlock, endBlock]`，提交后下一次从 `endBlock + 1` 开始；
  同一块超过 provider 单页上限时，重试该边界块或使用单块完整范围，不能跳过该块；
- 网络请求先在内存中得到一个完整可提交窗口，再在一个短事务中 upsert 事实、写
  `sync_windows`、更新 scope cursor。进程在请求后、提交前退出时，下一次安全重取；
- 默认使用 `reorgOverlapBlocks`（建议 12）回溯最近已完成区块。重叠范围内仅删除
  当前 ingestion source 的事实，再写入新结果；其它来源的数据不能被删除；
- `hasNext` 为 `nextBlock <= targetBlock`。当一次 update 完成目标且外部选择继续追踪
  最新区块时，下一次 update 才重新固定新目标；不会因为当前时间移动而改变已经返回
  的结果；
- `busy` 表示相同 scope 已有有效租约，调用方稍后重试；不重复并发请求同一个 scope；
- provider/API 错误只提交失败 run 和安全错误码，不推进 cursor。局部窗口不完整时，
  `status` 为 `partial` 且 `hasNext` 保持 true。

数据映射：

| dataset | 上游逻辑 | 最小事实身份 | 必须保留的内容 |
| --- | --- | --- | --- |
| `erc20` | `account/tokentx` | chain + user + txHash + logIndex；无 logIndex 时使用完整字段哈希 | token、from/to、amount、block、timestamp、transactionIndex、provider、原始来源 |
| `transactions` | `account/txlist` | chain + user + txHash | from/to、value、nonce、gas、input、status、block/timestamp、transactionIndex |
| `internal_native` | `account/txlistinternal` | chain + user + txHash + traceId；traceId 缺失时使用稳定字段哈希 | from/to、value、type、status、block/timestamp、provider |

amount、value、gas、block、timestamp 均以规范化十进制字符串暴露。原始 payload
可在配置开启时以受大小限制的 JSON 保存，用于审计，但不得保存 headers、key、完整
URL 或 proxy 信息；默认只保存规范化事实。

### 4.4 回放配置、状态和查询

```ts
interface ReplayConfiguration {
  readonly enabled?: boolean;
  readonly snapshotEveryEvents?: number; // 建议默认 10_000
  readonly snapshotEveryBlocks?: number; // 建议默认 10_000
  readonly maxEventsPerReplayStep?: number;
  readonly leaseMs?: number;
}

interface ReplayStatus {
  readonly requested: boolean;
  readonly runId: string | null;
  readonly status: "disabled" | "not_requested" | "queued" | "running" | "completed" | "failed";
  readonly fromBlock: string | null;
  readonly toBlock: string | null;
  readonly processedEvents: number;
  readonly snapshotBlock: string | null;
  readonly revision: string | null;
}
```

`replay: true` 只在本次事实事务提交后触发回放请求；它不是“update 内重新调用 API”。
同一用户/链只能有一个 running replay：

1. 事实事务提交时，按 changed block 计算最小 `fromBlock`，增加 `factsRevision`，
   upsert 一个幂等 replay job；正在运行时合并更小的起点和更大的终点，不新增并行 job。
2. 回放租约需要 owner、过期时间和 heartbeat；进程崩溃后过期 job 可被其它调用恢复。
   update 不等待长时间回放，返回 `history_replay_queued` 或
   `history_replay_running`。
3. 以 `(blockNumber, transactionIndex, logIndex/traceIndex, identity)` 稳定排序事实。
   先加载小于等于起点的最新同 revision 快照，再逐块应用 token transfer、native
   transaction value、internal native trace 和 gas 事实。负余额不要静默截成零，应
   记录 `incomplete`/`warnings`，因为数据可能不完整或 token 有 rebasing/非 Transfer
   变化。
4. 只在完整区块边界发布快照。默认以“先达到 10,000 个事件或 10,000 个区块”为阈值，
   两者取先到；这比单纯每 N 个动作更适合稀疏地址。阈值可配置，但不能在一个区块的
   中间发布可被查询的快照。
5. 快照按 `user + chain + revision + block` 保存，包含 token balance、累计转入/转出、
   native balance delta、交易计数和数据覆盖信息。当前 revision 的发布指针最后更新，
   查询不会读到半个回放结果；旧 revision 保留到维护者清理。
6. 发生重叠区块替换或检测到事实身份变化时，删除/失效大于等于重放起点的派生快照，
   从前一个快照重新构建；事实表是唯一真相，派生表可完全丢弃并重建。
7. 回放只承诺“可由已保存事实推出”的状态。协议动作、成本基础和价格估值应通过
   后续 reducer/消费者扩展，不能伪装成 SDK 已经知道的余额事实。

推荐历史服务方法：

```ts
client.history.getReplayStatus({ chain, address });

client.history.getUserStateAtBlock({
  chain,
  address,
  blockNumber,
  tokenAddresses?,
});

client.history.getTokenFlowHistory({
  chain,
  address,
  startBlock,
  endBlock,
  tokenAddress?,
  direction?: "incoming" | "outgoing" | "both",
  limit?,
  cursor?,
});

client.history.getTransactions({ chain, address, startBlock?, endBlock?, limit?, cursor? });
client.history.getInternalNativeTransfers({ chain, address, startBlock?, endBlock?, limit?, cursor? });
```

`getUserStateAtBlock` 返回 `state: "ready" | "building" | "partial" | "unavailable"`、
`revision`、`asOfBlock`、balances、flow totals、交易计数和 warnings。请求区块大于
最新已完成回放区块时不能返回假装完整的状态。`getTokenFlowHistory` 直接读取规范化
事实，区块号、交易哈希、log/trace identity 均保留，适合精确审计和分页。

### 4.5 特殊资产流向与回放校准规范 (Wrapped Native 与 Rebasing 计息资产)

#### 1. Wrapped Native (WETH/WBNB 等) 流水合成与排重
* **协议特性**：WETH9 合约在 `deposit()` 存入原生代币（或直接转入 ETH 铸造 WETH）时发出 `Deposit(dst, wad)` 事件（Topic0: `0xe1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c`），不发出标准 ERC-20 `Transfer(0x0, dst, wad)`；在 `withdraw(wad)` 提现时发出 `Withdrawal(src, wad)` 并通过内部交易发送原生代币。
* **回放合成规则**：
  * 在 `facts()` 加载交易日志时，识别目标为各链 Wrapped Native 合约（如 Ethereum Mainnet WETH `0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2`、Base WETH `0x4200000000000000000000000000000000000006`、Optimism WETH、Arbitrum WETH、Polygon WETH、BSC WBNB 等）的交易。
  * `deposit()` / Direct Wrap（`input` 以 `0xd0e30db0` 开头或为空、且 `value > 0`）：合成 `ZERO_ADDRESS -> user` 的 WETH 转账事实（`index: -1100000001n`, `ingestion_source: 'sdk_weth_deposit'`），若存在 canonical 转账则去重。
  * `withdraw(wad)` / Unwrap（`input` 以 `0x2e1a7d4d` 开头）：提取销毁数量，合成 `user -> ZERO_ADDRESS` 的 WETH 销毁事实（`index: -1100000000n`, `ingestion_source: 'sdk_weth_withdrawal'`），与 internal native transfer 配合闭环。

#### 2. Rebasing 计息代币 (Aave aToken 等) 0x0 内部结息过滤
* **协议特性**：Aave 等 Vault 在提现交易开始时先发出一条 `Transfer(0x0, user, interest)` 内部结息铸造事件，紧接着发出 `Transfer(user, 0x0, total)` 全额销毁本息。
* **回放归约规则**：
  * 在 `reduceFacts()` 中识别伴随同币转出的 0x0 内部结息（即转入来源为 `ZERO_ADDRESS`，且同一笔交易中用户存在该代币的转出 `from_address === user`）。
  * 该内部结息不计入用户的外部 `incoming` 流入，防止基准快照利息重复累加与 FIFO 开仓 Lot 无法全额核销（产生幽灵仓位）。
  * 普通存款铸造（无同币转出）正常保留 `incoming`，DEX 滑点退款（来源于 Router 地址而非 0x0）正常保留净额对冲。

### 4.6 修复、重采集和重建 API

增量 `update` 适合正常追赶数据；当 SDK 的 mapper、provider 适配器、去重规则或
回放 reducer 修复后，需要一组明确的修复 API。修复 API 必须带有显式范围，不能
因为一个参数就重置整个数据库。

#### `sync.recollect`

`recollect` 重新调用 provider，覆盖指定用户、链、数据集和闭区间。它不读取或写入
provider page cursor；范围很大时仍然按窗口返回 `hasNext`，调用方可以重复同一个
recollect scope。

```ts
interface RecollectRequest {
  readonly chain: ChainReference;
  readonly address: string;
  readonly dataset: "erc20" | "transactions" | "internal_native";
  readonly fromBlock: string;
  readonly toBlock: string;
  /** replace 删除该 dataset 自己在范围内的事实后再写入；merge 只 upsert。 */
  readonly strategy?: "replace" | "merge";
  readonly replay?: boolean;
  readonly dryRun?: boolean;
  readonly reason?: string;
  readonly signal?: AbortSignal;
}

interface RecollectResult extends DatasetUpdateResult {
  readonly operation: "recollect";
  readonly strategy: "replace" | "merge";
  readonly dryRun: boolean;
  readonly recordsDeleted: number;
  readonly affectedReplayFromBlock: string | null;
}
```

语义：

- `replace` 只删除相同 `(chainId, address, dataset, ingestionSource)` 在闭区间内的
  事实；不会删除其它用户、其它数据集、其它 ingestion source 或价格点；删除和新
  事实写入必须同一事务提交。默认建议使用 `replace` 修复 mapper/去重错误，`merge`
  适合 provider 只返回增量的场景。
- `dryRun: true` 只规划 provider 请求、估算将删除/写入的数量和受影响回放起点，不
  修改数据库；如果 provider 不支持预估，返回 `null` 计数而不是先执行删除。
- recollect 成功后 scope 的 `nextBlock` 只能推进到真正提交的窗口；如果范围位于
  已完成历史中，相关 revision 的派生快照必须失效。`replay: true` 会自动合并一个
  从最小受影响区块开始的回放 job。
- `reason` 只用于审计，长度和字符集受限，不能包含 SQL、URL、key 或原始 payload。
- Recollect 失败不会留下“已删除但未重写”的半成品；事务回滚后可以安全重复执行。

价格事实使用对应的 `client.price.recollect`，参数是 `token/exchange/market/interval`
和明确的 `[fromTimestamp, toTimestamp)`，另外支持 `strategy: "replace" | "merge"`、
`dryRun`、`reason` 和 `rebuildLookupCache`（如果实现有查询缓存）。它只替换对应
token/交易所/market/interval 的 points，不重置其它市场，也不改变链上同步 scope。

#### `history.rebuild`

`rebuild` 不请求 provider，只消费已持久化的 ERC-20、transaction 和 internal-native
事实。它用于 reducer、排序、快照、负余额处理或派生 schema 修改后的重构。

```ts
interface RebuildHistoryRequest {
  readonly chain: ChainReference;
  readonly address: string;
  /** targeted 从该区块开始使快照失效；full 从最早事实开始。 */
  readonly mode?: "targeted" | "full";
  readonly fromBlock?: string;
  readonly toBlock?: string;
  readonly force?: boolean;
  readonly reason?: string;
  readonly signal?: AbortSignal;
}

interface RebuildHistoryResult {
  readonly status: "queued" | "running" | "completed" | "busy" | "failed";
  readonly jobId: string;
  readonly chainId: number;
  readonly address: string;
  readonly mode: "targeted" | "full";
  readonly invalidatedFromBlock: string | null;
  readonly targetBlock: string | null;
  readonly factsRevision: string;
  readonly replayRevision: string | null;
  readonly snapshotsInvalidated: number;
  readonly errorCode?: string;
}
```

语义：

- `targeted` 默认从 `fromBlock` 开始；省略时使用最早受影响事实或当前 revision 的
  最早可重建快照。`full` 使该用户/链所有派生快照失效，从最早已落库事实重放，适合
  reducer 算法版本改变。
- `toBlock` 默认使用当前已落库事实的最大完整区块，而不是 provider 的 latest；没有
  事实时返回 `completed` 且明确 `targetBlock: null`。
- `force: true` 允许在没有新事实时重建；默认如果没有受影响 revision 则返回
  `completed`/`busy` 而不制造空 job。
- 同一用户/链的 running job 会合并更早的起点和更晚的目标，不能并行写快照。旧
  revision 在新 revision 完整发布前仍可查询；新 revision 失败时 current pointer
  不变。
- `rebuild` 只能重建派生状态，不能偷偷修正事实。事实有问题必须先 `recollect`，
  再 `rebuild`；两者可用 `replay: true` 通过 recollect 自动串接。

当事实和 reducer 都没有变化、只是回放任务中断或需要重新执行当前 revision 时，提供
较轻量的 `history.replay`。它复用当前 revision 的快照和事实，不主动使所有快照失效；
`fromBlock` 省略时从最早未完成的快照边界继续，`force: true` 才从指定边界重新执行。
`history.rebuild` 适用于 reducer/schema 算法变化，`history.replay` 适用于任务恢复，
两者不能用一个模糊的 `reset` 参数混在一起。

```ts
client.history.replay({
  chain: "ethereum",
  address,
  fromBlock: "19000000",
  toBlock: "19500000",
  force: true,
  reason: "resume interrupted replay",
});
```

#### `sync.audit`

修复前先运行只读审计，帮助确认问题属于 provider 事实还是派生状态：

```ts
interface AuditSyncRequest {
  readonly chain: ChainReference;
  readonly address: string;
  readonly dataset?: "erc20" | "transactions" | "internal_native";
  readonly fromBlock?: string;
  readonly toBlock?: string;
  readonly checks?: readonly ("gaps" | "duplicates" | "cursor" | "replay_coverage")[];
  readonly signal?: AbortSignal;
}

interface AuditSyncResult {
  readonly status: "ok" | "issues_found" | "incomplete";
  readonly chainId: number;
  readonly address: string;
  readonly dataset: string | null;
  readonly checkedRange: BlockRange | null;
  readonly gapRanges: readonly BlockRange[];
  readonly duplicateCount: number;
  readonly cursorConsistent: boolean | null;
  readonly replayCoverage: { readonly asOfBlock: string | null; readonly revision: string | null };
  readonly issues: readonly { readonly code: string; readonly detail: string }[];
}
```

`audit` 不请求 provider、不修改数据库、不自动触发 recollect/rebuild；它只读取本地
事实、scope、run/window 和 replay metadata。`issues` 必须脱敏且有数量上限，避免把
全量数据或 SQL 作为诊断结果返回。

#### 状态、重置和修复工作流

为便于运维，建议同时提供以下只读/显式操作：

```ts
client.sync.getStatus({ chain, address, dataset });
client.sync.audit({ chain, address, dataset, fromBlock, toBlock });
client.price.getSyncStatus({ token, exchange, market, interval });
client.history.getReplayStatus({ chain, address });
client.history.replay({ chain, address, fromBlock, toBlock, force: true, reason });
client.history.rebuild({ chain, address, mode: "targeted", fromBlock, reason });
client.sync.recollect({
  chain, address, dataset: "erc20", fromBlock, toBlock,
  strategy: "replace", replay: true, dryRun: false,
  reason: "fix transfer mapper v2",
});
```

推荐的修复顺序是：先升级 SDK 并跑离线 fixture，再用 `dryRun` 检查范围和计数，执行
`recollect(strategy: "replace")`，等待或查询 replay 状态，最后用
`getUserStateAtBlock` 和 `getTokenFlowHistory` 对比修复前后的结果。SDK 不提供无参数
的“清空所有数据”快捷方法；全库删除必须由用户在数据库层明确执行。

## 4.6 典型调用方式

```ts
const client = new EvmDataClient({
  storage: { url: "sqlite:./data/evm-data-sdk.db" },
  sync: { replay: { enabled: true } },
  providers: [{ kind: "etherscan", apiKeys: [process.env.ETHERSCAN_API_KEY!] }],
});

await client.initialize();

let next = true;
while (next) {
  const result = await client.sync.update({
    chain: "ethereum",
    address: "0x1111111111111111111111111111111111111111",
    dataset: "erc20",
    replay: true,
  });
  if (result.status === "busy" || result.status === "history_replay_running") break;
  next = result.hasNext;
}

const priceUpdate = await client.price.update({
  token: "ETH",
  exchange: "binance",
  market: "ETHUSDT",
  interval: "1m",
  fromTimestamp: "2026-01-01T00:00:00.000Z",
  toTimestamp: "2026-01-02T00:00:00.000Z",
});

const state = await client.history.getUserStateAtBlock({
  chain: "ethereum",
  address: "0x1111111111111111111111111111111111111111",
  blockNumber: "19000000",
});

await client.close();
```

真实应用应按返回的 `busy`、`failed`、`history_replay_queued` 和
`history_replay_running` 制定自己的退避/轮询策略；SDK 不会偷偷创建后台循环。价格
update 也应在 `hasNext` 为 true 时再次调用，并通常让 SDK 从数据库的
`nextFromTimestamp` 继续，而不是保存 provider 返回的 page 参数。

## 5. 存储模型

逻辑表名可以调整，但下列职责必须存在。每个表需要 PostgreSQL 和 SQLite 的等价迁移、
唯一键、必要索引和版本号。

| 表 | 作用 | 关键字段/约束 |
| --- | --- | --- |
| `sdk_schema_migrations` | 迁移版本 | version unique、appliedAt |
| `sdk_sync_scopes` | 每个用户/链/数据集的游标 | scope unique、target/next/lastComplete、status、lease |
| `sdk_sync_runs` | 每次 update 审计 | runId、scope、requested/covered range、status、counts、provider、errorCode |
| `sdk_sync_windows` | 已提交的闭区间 | runId、scope、start/end、records、committedAt |
| `sdk_erc20_transfers` | ERC-20 原始事实 | canonical identity unique、amount text、block/timestamp、provider |
| `sdk_transactions` | txlist 原始事实 | chain/user/txHash unique、完整 envelope、provider |
| `sdk_internal_native_transfers` | txlistinternal 原始事实 | canonical trace identity unique、value text、provider |
| `sdk_price_sync_scopes` | token/交易所/market 的时间游标 | nextFrom、target、lastPoint、lease、status |
| `sdk_price_points` | OHLCV/price 事实 | token/exchange/market/interval/timestamp unique、价格 decimal text |
| `sdk_replay_jobs` | 回放请求和租约 | user/chain、from/to、status、factsRevision、lease |
| `sdk_user_state_snapshots` | revision 级快照元数据 | user/chain/revision/block unique、eventCount、complete |
| `sdk_user_state_balances` | 快照中的 token 状态 | snapshot/token unique、raw amount text、in/out totals |
| `sdk_replay_current` | 当前已发布 revision 指针 | user/chain unique、revision、asOfBlock |

事实表索引至少覆盖 `(chain_id, user_address, block_number)`、token 和时间范围；价格
表覆盖 `(token_key, exchange, market, interval, timestamp_ms)`；状态表覆盖可领取的
status/lease。SQLite 的整数读取必须配置为 BigInt 或安全字符串，PostgreSQL 使用
`BIGINT`/精确 decimal；业务层不能依赖驱动默认 number 转换。

所有写入使用 prepared statement/参数绑定。批量 insert 分块，避免 PostgreSQL 参数
上限和 SQLite 变量上限。upsert 冲突更新只改允许修订的字段，不覆盖事实身份。

## 6. 组件边界和数据流

```text
EvmDataClient
  |
  +-- StorageAdapter -> MigrationRunner -> SQLite/PostgreSQL
  |
  +-- SyncService
  |     +-- ScopeLease
  |     +-- BlockWindowPlanner
  |     +-- Existing provider/range APIs
  |     +-- FactRepository + SyncRunRepository
  |
  +-- PriceSyncService
  |     +-- HistoricalPriceProviderAdapter
  |     +-- TimestampWindowPlanner
  |     +-- PriceFactRepository
  |
  +-- HistoryService
        +-- ReplayJobRepository / ReplayLease
        +-- StateReducer
        +-- SnapshotRepository
        +-- FactQueryRepository
```

`SyncService` 负责 scope、窗口和事务，不负责 provider schema；provider adapter 负责
一次上游尝试，不负责持久化游标。`HistoryService` 只能消费规范化事实，不重新调用
provider。`StorageAdapter` 隔离 SQL 方言、事务、租约和 BigInt 表示；不要把 TypeORM
实体或 Nest injectable 引入 SDK。

## 7. 一次完整调用的时序

```text
update(scope)
  -> normalize chain/address/range
  -> acquire scope lease (busy if another owner is active)
  -> load or create durable target and next cursor
  -> request one bounded provider range (no durable API page)
  -> detect covered block/time boundary and validate records
  -> transaction:
       upsert normalized facts
       record sync window/run counters
       advance cursor only to committed covered end
       enqueue/coalesce replay job when replay=true
     commit
  -> release lease
  -> return hasNext + replay status
```

事务提交前任何异常都不能推进游标。提交后释放租约失败不应撤销已提交事实；下一次
调用应能回收过期租约。对同一个 scope 的重复 update 必须是幂等的。

## 8. 错误、可观测性和安全

建议新增错误码：`STORAGE_NOT_CONFIGURED`、`STORAGE_NOT_INITIALIZED`、
`STORAGE_MIGRATION_FAILED`、`STORAGE_BUSY`、`SYNC_SCOPE_CONFLICT`、
`SYNC_CURSOR_INVALID`、`PROVIDER_STALLED`、`REPLAY_IN_PROGRESS`、
`REPLAY_INCOMPLETE`、`TOKEN_AMBIGUOUS`、`PRICE_RANGE_INVALID`、
`PRICE_NOT_FOUND`、`PRICE_DATA_UNAVAILABLE`。错误只包含安全的 scope、chainId、
数据集、范围和稳定 provider 名称；不包含 URL、key、密码、原始 payload。

telemetry 可以记录 operation、chainId、dataset、window size、records、duration、
provider、status 和 errorCode。不要记录地址全量、token 量、价格、SQL、cursor 原文
或数据库 URL；必要时使用短 hash。

## 9. 验收标准

- 未配置 storage 时使用 `./data/evm-data-sdk.db`，首次运行可创建目录、迁移和关闭；
  PostgreSQL URL 和 SQLite URL 都能通过同一套领域测试。
- `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm test:package` 通过；
  默认测试不访问真实 provider 或真实数据库服务。
- 每个数据集覆盖 provider 单页边界、单块超量、空结果、重复调用、进程中断后重试、
  provider 失败、租约过期和重组重叠窗口。
- 任意 update 的 `hasNext` 由持久化时间/区块范围决定；测试证明不会把 API page
  cursor 保存为业务游标，也不会在满页时跳过最后一个区块。
- 价格测试覆盖交易所最大限制、时间对齐、空窗、重复写入、附近查询、批量查询、
  距离上限和 token 歧义。
- 回放测试覆盖事件排序、快照阈值、从快照恢复、负余额 warning、并发 job 合并、
  崩溃恢复、revision 发布原子性和指定区块状态查询。
- PostgreSQL/SQLite 查询结果字段和状态语义一致；大整数 fixture 使用超过 JS 安全
  整数的 token amount 验证无精度损失。
- README、`docs/SPEC.md`、`docs/ARCHITECTURE.md`、`docs/INTEGRATIONS.md`、
  `docs/DECISIONS.md` 和 `docs/NEXT_SESSION.md` 在实现完成后同步更新；本目录文档
  的状态也必须更新为实际实现状态。

## 10. 重要决策

1. 业务游标是区块或 timestamp，provider page 只属于一次网络调用；这是保证多次
   update 可恢复、可换 provider、可审计的核心约束。
2. 事实和派生状态分离。事实可幂等重取，派生状态可按 revision 丢弃重建，避免把
   中间回放结果误当成最终余额。
3. 回放默认异步且可合并。update 的职责是落库并报告状态，不能被数百万历史事件
   阻塞；调用方用 `getReplayStatus` 决定何时读取完整状态。
4. 快照阈值以事件数为主、区块边界为硬约束。稀疏地址不会产生大量无意义快照，密集
   地址也不会每次查询从头扫描。
5. SQLite 是单进程/轻量部署的默认存储，PostgreSQL 用于并发 worker 和多进程共享；
   SDK 不根据数据库类型改变公共 API 语义。
