# EVM Data SDK 持久化采集与历史回放任务拆分

状态：Package 1-11 已建立首版实现骨架；Package 12 全量验证和 PostgreSQL/live contract 尚未完成。

实现模型必须按顺序执行。每个工作包开始前先检查本仓库的未提交改动，列出将要
修改的文件和影响；完成后运行该包的验证并更新 `docs/NEXT_SESSION.md`。不得把
NestJS/TypeORM 的后端代码直接复制到 SDK。

## Package 0：上下文审计和架构闸门

阅读顺序：

1. `Agent.md`、`docs/SPEC.md`、`docs/ARCHITECTURE.md`、`docs/BUILD.md`、
   `docs/INTEGRATIONS.md`、`docs/DECISIONS.md`、`docs/NEXT_SESSION.md`；
2. 本目录的 `UPGRADE.md` 和本文件；
3. 当前 `EvmDataClient`、configuration/schema、`AddressService`、`TokenService`、
   `BlockRangeScanner`、现有 range/window 模型和所有相关测试；
4. `/home/sean/ems/astarfi/astar-fi-backend` 中本升级说明列出的同步、价格、实体和
   回放实现。

交付：一份 Step 0/Step 1 报告，明确：当前是否真的存在 storage URL、现有 `initialize`
和 `close` 生命周期、provider range API 的边界、数据库 driver 选择、迁移策略、
公共 API 文件、未知问题和风险。若需求描述与代码冲突，先在文档中记录并请求批准，
不要为了“看起来已经存在”而跳过基线修正。

本包不改 `src/`、不安装依赖、不发真实网络请求。

## Package 1：Storage 配置、driver 和迁移框架

建议文件（可按现有责任边界调整）：

- `src/domain/configuration.ts`、`src/domain/errors.ts`；
- `src/storage/StorageAdapter.ts`、`src/storage/StorageTransaction.ts`；
- `src/storage/SqliteStorageAdapter.ts`、`src/storage/PostgresStorageAdapter.ts`；
- `src/storage/MigrationRunner.ts`、`src/storage/migrations/*`；
- `src/client/EvmDataClient.ts`、`src/index.ts`；
- `package.json`、`pnpm-lock.yaml`（只有获准新增依赖时）；
- storage 配置、生命周期和迁移测试。

要求：

- 严格解析 `postgres://`、`postgresql://`、SQLite URL/路径和默认
  `./data/evm-data-sdk.db`；URL、密码和路径的错误信息要脱敏；
- 构造函数无连接/迁移副作用，`initialize()` 和 `close()` 可重复调用；
- 迁移版本表、事务、参数绑定、BigInt/decimal 安全转换、SQLite busy timeout、
  PostgreSQL 连接释放可测试；
- 默认 SQLite 不要求外部服务；多进程并发只承诺 PostgreSQL，SQLite 明确返回 busy
  而不是死锁；
- 记录选用的 driver、版本和为何适合 Node >= 24。优先评估 Node 24 内置 SQLite
  能力；若选择 `pg`/`better-sqlite3` 等依赖，遵守 `docs/INTEGRATIONS.md` 要求。

验收：两种数据库使用同一组 storage contract tests；不存在业务表时自动迁移；大整数
和秘密脱敏测试通过。

## Package 2：持久化模型和仓储 contract

建议文件：

- `src/storage/schema.ts` 或迁移 SQL；
- `src/sync/SyncScopeRepository.ts`、`SyncRunRepository.ts`、`FactRepository.ts`；
- `src/price/PriceSyncRepository.ts`；
- `src/history/ReplayRepository.ts`、`SnapshotRepository.ts`；
- `tests/contract/storage-repository.test.ts`、fixtures。

实现规范化事实表、sync scope/run/window、price scope/points、replay job、snapshot
和 current revision。每个 identity 和索引必须对应 `UPGRADE.md`；不要只保存最终余额。

重点测试：

- ERC-20、transaction、internal trace 的唯一键、空 log/trace fallback identity；
- provider 修订同一事实时的幂等 upsert，不增加重复行；
- cursor 只能在同一事务中随事实提交；
- PostgreSQL/SQLite 查询顺序、`NULL`、时间范围和 BigInt 表示一致；
- `SELECT ... FOR UPDATE SKIP LOCKED` 与 SQLite `BEGIN IMMEDIATE` 的 lease 行为通过
  同一抽象测试验证；
- 删除/替换重叠 ingestion source 时不会触碰其它来源。

## Package 3：通用 scope lease、窗口游标和 update result

建议文件：

- `src/sync/SyncService.ts`；
- `src/sync/BlockWindowPlanner.ts`、`src/sync/SyncLease.ts`；
- `src/domain/syncModels.ts`、`src/domain/syncOperations.ts`；
- `src/client/EvmDataClient.ts`、`src/index.ts`；
- 同步状态、租约、窗口和 crash recovery 单元测试。

先实现不绑定具体数据集的 update 骨架：规范化 range、取得/续租 scope、固定 target、
回收过期 lease、执行 bounded fetch port、事务提交、计算 `hasNext`、返回安全状态。

强制约束：

- scope key 不得包含 provider page cursor；
- `fromBlock` 冲突时明确报错，不能静默重置；
- provider 未返回可推进的 `coveredEndBlock` 时失败并保持原 cursor；
- `hasNext` 必须由持久化 `nextBlock <= targetBlock` 计算；
- 同 scope 并发 update 返回 `busy`，不同 scope 可以并行；
- 一次网络窗口和一次数据库事务有明确上限，不能把全历史聚合到内存。

验收：用假的 fetch port 模拟空窗口、满窗口、单块超量、异常、重复调用、进程在
commit 前退出、lease 过期和重试，证明不会跳块或重复推进。

## Package 4：ERC-20 `tokentx` update

建议文件：

- `src/sync/Erc20TransferSync.ts`；
- 复用/扩展现有 `src/services/TokenService.ts`、`src/domain/models.ts` 的 range/window
  port，不复制 provider mapper；
- Erc20 fixture、provider contract 和同步集成测试。

实现：按 `(chain,address)` 采集 ERC-20 transfer，默认使用 SDK 现有的 block-range
operation/`onWindow`，让 SDK adaptive scanner 处理 provider page；持久化层只接收完整
窗口和 `coveredEndBlock`。若必须使用 page adapter，page 只存在于一次 update，满页时
保留最后 block 并重试，单 block 超量使用单块完整 range API。

保留 `transactionIndex`、`logIndex`、token metadata、amount、timestamp、provider；
把 address 统一小写、amount/block/timestamp 统一为十进制字符串。每个窗口写
discovered token metadata（如采用）和事实，完成后推进 scope。

验收：`tokentx` 空结果、跨 provider fallback、满页边界、同一事件重复、同一块超过
限制、重叠刷新和大 amount 均通过；没有任何持久化 API page cursor。

## Package 5：`txlist` 和 `txlistinternal` update

建议文件：

- `src/sync/TransactionSync.ts`；
- `src/sync/InternalNativeTransferSync.ts`；
- 现有 `AddressService`/`ApiChainService` 对应的适配层；
- transaction/internal fixture 和 contract tests。

两类数据共用 Package 3 的窗口事务，但事实表和 identity 分开。`txlist` 保存完整
交易 envelope、gas、status、input；`txlistinternal` 保存 traceId、type、status 和
native value。不要把 internal transfer 当作一条普通 top-level transaction，也不要
把 gas 伪造成 zero-amount token transfer。

验收：两个数据集各自拥有独立 cursor/status/provider；一个失败不会推进另一个数据集；
同 tx 多 trace 不丢失；跨块、空 `to`、空 traceId 和状态 unknown 均有 fixture。

## Package 6：价格历史 update 和价格仓储

建议文件：

- `src/domain/priceSyncModels.ts`、`src/domain/priceSyncOperations.ts`；
- `src/price/HistoricalPriceProviderAdapter.ts`；
- `src/price/PriceSyncService.ts`、`src/price/PriceSyncRepository.ts`；
- `src/providers/price/*` 中必要的 timestamp-range capability；
- `src/client/EvmDataClient.ts`、`src/index.ts`；
- 价格 update/adapter/数据库测试。

要求：

- token resolution、market/quote/interval 形成稳定 scope key；歧义必须失败；
- provider adapter 接受 `[from,to)` 和 limit，单次最多拿到该 exchange 的真实上限；
- 不把 Binance/OKX 等 page token/page number 写入数据库；
- 对齐 timestamp、校验正价格和 OHLCV，去重后在一个事务中写 points + progress；
- 返回 `coveredRange`、`nextFromTimestamp`、`hasNext`；空响应必须可推进或安全停住；
- 价格原始精度使用 decimal/string，不能使用浮点数作为持久化真相；
- 不同交易所结果分开保存，不跨 quote currency 自动换算或平均。

验收：每个内置交易所覆盖最大返回数量、时间边界、重复 update、provider failure、
gaps、市场歧义和中断恢复；使用假的 adapter，不访问真实市场 API。

## Package 7：价格查询和批量查询

建议文件：

- `src/price/PriceQueryService.ts`；
- `src/domain/priceQueryModels.ts`；
- `src/client/EvmDataClient.ts`、`src/index.ts`；
- `getPriceAt`、`getPricesAt`、range 查询测试。

实现 before/after/nearest、最大距离、同一 timestamp 多 token 批量查询。PostgreSQL
可以使用 lateral/窗口查询，SQLite 使用等价相关子查询，但必须经过同一 repository
接口。返回 `priced/missing/unsupported/ambiguous`，绝不返回 0 或静默使用无关来源。

验收：前后点、等距 tie-break、边界、批量部分缺失、不同 market 隔离和大时间戳通过。

## Package 8：回放 reducer、快照和 job lease

建议文件：

- `src/history/StateReducer.ts`；
- `src/history/HistoryReplayService.ts`、`ReplayJobRepository.ts`；
- `src/history/SnapshotRepository.ts`；
- `src/domain/historyModels.ts`、`src/domain/historyOperations.ts`；
- 回放和快照测试。

先实现可由事实推出的最小状态：每个 token raw balance、in/out totals、native value
delta、gas 统计、交易数、最后事实 block 和 warnings。reducer 接口要允许后续加入
协议动作，但本包不能引入协议猜测。

回放规则：

- facts revision 变化时 coalesce `(user,chain)` 的 replay job；
- per-user lease + heartbeat + stale recovery；
- 只从 `blockNumber <= fromBlock` 的最新同 revision snapshot 开始；
- 事件排序稳定，按完整区块提交；
- 每 `snapshotEveryEvents` 或 `snapshotEveryBlocks` 先到即做快照，默认 10,000；
- 快照和 current revision publish 必须原子；失败时旧 revision 仍可读；
- 回放起点发生重组时失效之后的派生快照并重建。

验收：事件顺序、快照恢复、阈值、负余额 warning、job 合并、lease recovery、失败
重试、revision 隔离和大历史分块均有离线测试。

## Package 9：历史查询 API

建议文件：

- `src/history/HistoryQueryService.ts`；
- `src/client/EvmDataClient.ts`、`src/index.ts`；
- domain models、分页 cursor 和查询测试。

提供：

- `getReplayStatus`；
- `getUserStateAtBlock`；
- `getTokenFlowHistory`（区块范围、方向、token、精确 block/tx/log）；
- `getTransactions` 和 `getInternalNativeTransfers` 的持久化查询。

状态查询必须说明 `ready/building/partial/unavailable` 和 `asOfBlock`。请求区块超过
完成回放边界时不能伪造完整数据；事实查询可以在回放未完成时返回已入库窗口，但要
附带 coverage。持久化分页 cursor 只由 SDK 自己编码，包含 semantic query hash，
不能携带 provider secret。

验收：任意块前后余额、范围内 token 转入/转出、方向过滤、分页稳定性、回放未完成和
revision 切换通过。

## Package 10：修复 API：recollect、rebuild 和数据质量工具

建议文件：

- `src/sync/RecollectService.ts`、`src/sync/SyncAuditService.ts`；
- `src/price/PriceRecollectService.ts`；
- `src/history/HistoryRebuildService.ts`、`src/history/HistoryReplayService.ts`；
- `src/domain/repairModels.ts`、`src/domain/repairOperations.ts`；
- `src/client/EvmDataClient.ts`、`src/index.ts`；
- recollect/rebuild 的 dry-run、范围隔离、事务回滚、状态合并和审计测试。

实现 `sync.recollect`、`sync.audit`、`price.recollect`、`history.replay` 和
`history.rebuild`：

- 链上 recollect 必须要求明确的闭区间 `fromBlock`/`toBlock`，默认
  `strategy: "replace"` 只删除相同 user/chain/dataset/ingestionSource 的范围事实；
- `dryRun` 不能写库，必须报告或明确表示未知的删除/写入计数；
- replace 的删除、provider 重采集、事实 upsert、cursor/affected replay 更新必须在
  一个可回滚事务中完成；失败不能留下空洞；
- 大范围 recollect 仍返回 `hasNext`，不把 provider page cursor 变成业务状态；
- 价格 recollect 只影响指定 token/exchange/market/interval 的时间范围，不能重置
  其它 price scope；
- history rebuild 不调用 provider，只重建派生状态；`targeted` 从指定区块失效快照，
  `full` 从最早事实重建；新 revision 完整发布前 current pointer 不变；
- history replay 不改变 facts/reducer revision，默认从最早未完成快照恢复，`force` 才从
  指定区块重新执行；它适合任务中断恢复，不能替代 reducer 变更后的 rebuild；
- 同一用户/链的 running rebuild 必须合并起点/终点并返回 `busy`、`queued` 或
  `running`，不能并行写同一组快照；
- sync audit 只读检查 gaps、duplicates、cursor 和 replay coverage，不请求 provider、
  不修改数据库、不自动触发修复；诊断结果必须限量和脱敏；
- reason 只做受限审计文本，所有错误/日志继续脱敏；
- 不实现无参数全库清空 API，避免误操作。

验收：先写入一组错误 fixture，再用 audit 定位问题，执行 recollect 指定范围，证明
范围外和其它 ingestion source 不变；模拟 commit 前失败证明原事实完整；执行
targeted/full rebuild 和可中断 replay，证明旧 revision 可读、新 revision 原子发布；
重复调用和并发调用均幂等。

## Package 11：Client composition、文档和兼容性

建议文件：

- `src/client/EvmDataClient.ts`、`src/index.ts`；
- `README.md`；
- `docs/SPEC.md`、`docs/ARCHITECTURE.md`、`docs/INTEGRATIONS.md`、
  `docs/DECISIONS.md`、`docs/NEXT_SESSION.md`；
- 本目录文档的状态和实现引用。

把 `storage`、`sync`、`price`、`history` 服务组合到 client，保持原有无状态读取、
provider fallback、proxy 和 `initialize()` 语义。没有 storage 时，原有只读方法不能
因为新功能而回归；需要数据库的 API 给出 typed error。只导出稳定的 public types，
不要导出 driver 实例、SQL、连接池或 Nest 类型。

## Package 12：全量验证和可选 live smoke

离线顺序（任一步失败就停止并修复）：

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:package
pnpm check
```

附加检查：

- SQLite 临时文件迁移、关闭后重新打开、故障重试；
- PostgreSQL live contract（仅维护者显式提供 URL 时执行）；
- provider live smoke 每个数据集最多一个小地址/小范围，输出只能有 chainId、稳定
  provider、counts、status 和 errorCode；
- 不打印数据库 URL、API key、代理、完整地址、价格、payload 或 cursor；
- 检查 `git diff --check` 和只修改了任务相关文件。

## Package 13：实现后维护规则

任何新增 provider、数据集、价格 interval 或 reducer 必须同时更新：

- 公共模型和 capability；
- storage migration 与 contract tests；
- `UPGRADE.md`/`SPEC.md`/`ARCHITECTURE.md`；
- provider integration 事实和限制；
- `NEXT_SESSION.md` 的下一步与未验证风险。

不能仅新增一个 adapter 就声称支持持久化 update；必须证明业务游标、幂等写入、回放
和查询契约仍然成立。
