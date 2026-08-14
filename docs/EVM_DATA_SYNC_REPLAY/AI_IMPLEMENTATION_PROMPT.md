# Ready-to-paste implementation prompt

将下面整个代码块复制给 Claude Sonnet 5 或 ChatGPT Terra，并让它访问
`/home/sean/git/EVM-Data-SDK`。本提示词要求模型先完成架构闸门，再在批准后实现。

```text
你是 /home/sean/git/EVM-Data-SDK 的资深 TypeScript SDK 实现工程师。

任务：实现
docs/EVM_DATA_SYNC_REPLAY/UPGRADE.md
中定义的“持久化采集、价格时间范围 update、用户历史回放和查询”升级。
任务拆分必须遵守
docs/EVM_DATA_SYNC_REPLAY/TASK_BREAKDOWN.md
的顺序。当前用户只要求文档已经准备好；你的实现工作必须在仓库内完成，不能把
后端代码、SQL 或伪实现粘贴到聊天中代替提交。

强制阅读（必须读完整，不要只读摘要）：

  Agent.md
  docs/SPEC.md
  docs/ARCHITECTURE.md
  docs/BUILD.md
  docs/INTEGRATIONS.md
  docs/DECISIONS.md
  docs/NEXT_SESSION.md
  docs/EVM_DATA_SYNC_REPLAY/UPGRADE.md
  docs/EVM_DATA_SYNC_REPLAY/TASK_BREAKDOWN.md

必须审计当前源码：

  src/client/EvmDataClient.ts
  src/domain/configuration.ts
  src/domain/models.ts
  src/domain/operations.ts
  src/domain/priceModels.ts
  src/domain/priceOperations.ts
  src/services/AddressService.ts
  src/services/TokenService.ts
  src/services/ApiChainService.ts
  src/execution/BlockRangeScanner.ts
  src/execution/RequestExecutor.ts
  src/index.ts
  对应 provider adapter 和所有相关 tests

参考实现（只提取语义，不能直接复制 NestJS/TypeORM）：

  /home/sean/ems/astarfi/astar-fi-backend/src/token-tracking/evm-data-sdk.service.ts
  /home/sean/ems/astarfi/astar-fi-backend/src/token-tracking/evm-historical-backfill.worker.ts
  /home/sean/ems/astarfi/astar-fi-backend/src/token-tracking/evm-data-sync.coordinator.ts
  /home/sean/ems/astarfi/astar-fi-backend/src/token-tracking/historical-price-collector.service.ts
  /home/sean/ems/astarfi/astar-fi-backend/src/token-tracking/historical-token-price.service.ts
  /home/sean/ems/astarfi/astar-fi-backend/src/token-tracking/token-price-1m.repository.ts
  /home/sean/ems/astarfi/astar-fi-backend/src/database/entities/core.entity.ts
  /home/sean/ems/astarfi/astar-fi-backend/src/token-tracking/action-parser.service.ts

第一阶段：上下文审计和架构闸门

1. 先查看 git status，保留所有用户已有改动，不要 reset、checkout 或删除文件。
2. 逐项说明当前 SDK 是否已经有 storage URL、SQLite/PostgreSQL driver、migration、
   initialize/close、block-range window 和持久化服务。用户描述的默认数据库是
   ./data/evm-data-sdk.db；如果当前分支没有它，必须如实记录“缺口”，不能假设它存在。
3. 输出一份简短但具体的 Step 0/Step 1 报告：现状、差异、建议文件、公共 API、
   数据流、driver 选择、方言风险、并发/重组/精度风险和测试 seam。
4. 在没有得到用户明确的“APPROVE IMPLEMENTATION”之前，不要修改 src、package.json、
   lockfile 或安装依赖。只允许在报告中提出方案；不要通过自动批准继续。

第二阶段：按 TASK_BREAKDOWN.md 实现

获得批准后，严格按 Package 1 到 Package 13 执行。每个 package 开始前：

- 列出准备修改的文件、原因、公共行为变化和预期测试；
- 检查用户已有改动，不能覆盖或回滚；
- 如果官方 API、当前 provider 行为或 Node 版本能力与文档冲突，先停在该 package，
  更新文档并请求决定，不要用猜测实现。

每个 package 完成后：

- 运行该 package 的最小离线测试；
- 报告失败、剩余风险和下一步；
- 更新 docs/NEXT_SESSION.md，保持文档与源码一致；
- 使用 apply_patch 编辑，禁止 git reset --hard、git checkout、批量删除、push 或
  重写 git 历史；不要伪造 git identity。

不可违反的产品契约

1. 存储和生命周期

- 配置支持 postgresql://、postgres://、SQLite URL/文件路径；没有 storage.url 时
  默认 sqlite:./data/evm-data-sdk.db。
- SQLite 第一次使用创建父目录和数据库；PostgreSQL/SQLite 共享同一迁移版本和领域
  契约。驱动选择必须记录在 docs/INTEGRATIONS.md。
- 构造函数不能做网络业务请求；initialize() 执行连接、迁移和已启用 runtime 初始化；
  close() 幂等释放资源。没有 storage 的旧只读 client 不能回归，需要 DB 的方法要有
  typed STORAGE_NOT_INITIALIZED。
- 连接 URL、密码、API key、proxy URL、Authorization、完整请求 URL、SQL、payload、
  cursor 原文和原始 provider error 不能出现在 public result、错误或日志。

2. 链上 update

- 提供等价于 client.sync.update 的 ERC-20、transactions、internal_native 三类能力，
  也可提供更明确的 updateTokenTransfers/updateTransactions/updateInternalTransfers
  包装；公共 API 必须在 domain 类型中稳定导出。
- scope key 是 chainId + 小写 address + dataset。首次可给 fromBlock，后续省略时从
  持久化 nextBlock 继续；不一致的显式起点必须报 scope conflict，不能静默 reset。
- toBlock 缺省时读取一次 finalized/safe head 并固定本次目标；一次 update 只提交一个
  有界闭区间窗口。下一次 update 才可追新目标。
- provider page token/page number 只能存在于一次请求栈，绝不能成为业务游标。优先
  使用现有 block-range/onWindow API；满页时根据 coveredEndBlock 重试边界块，单块
  超量必须使用单块完整范围或返回安全错误，不能跳过记录。
- 事实 upsert、sync run/window、cursor 推进和 replay enqueue 必须在一个事务中提交。
  网络失败、abort、崩溃或 provider stall 不能推进 cursor。重试同一窗口必须幂等。
- 返回 status、targetBlock、requested/covered range、nextBlock、recordsSeen、
  recordsWritten、duplicates、provider、runId、replay status 和 hasNext；hasNext
  只由持久化 nextBlock <= targetBlock 决定。
- 默认用可配置的 reorgOverlapBlocks（建议 12）重新采集重叠区间，只删除自己的
  ingestion source；不影响其它来源。保留 provider provenance。
- `tokentx` 必须保留 token/from/to/amount/block/timestamp/transactionIndex/logIndex；
  `txlist` 必须保留交易 envelope、gas、input、status；`txlistinternal` 必须保留
  traceId、type、native value 和 status。不能把 gas 伪造成 token transfer。
- 所有链上整数在 public model 和 repository 边界使用十进制字符串或 BigInt；禁止
  JavaScript number 处理 token amount、gas、block、timestamp。

3. 修复、重采集和重建

- 提供 `client.sync.recollect`：必须要求明确的 `fromBlock`/`toBlock`，默认
  `strategy: "replace"` 只删除相同 user/chain/dataset/ingestionSource 的范围事实，
  然后重新拉取并幂等写入；支持 `strategy: "merge"`、`dryRun`、`reason`、`replay`，
  大范围仍返回 `hasNext`，绝不保存 provider page cursor。
- 提供只读 `client.sync.audit`：检查 gaps、duplicates、cursor consistency 和 replay
  coverage；它不请求 provider、不修改数据库、不自动触发修复，诊断结果必须限量脱敏。
- 提供 `client.price.recollect`：只替换明确 token/exchange/market/interval 的
  `[fromTimestamp,toTimestamp)` points；不能重置其它价格 scope。
- 提供 `client.history.rebuild`：不请求 provider，只基于事实重建派生状态；支持
  `mode: "targeted" | "full"`、`fromBlock`、`toBlock`、`force`、`reason`，使用新的
  facts/replay revision 和原子 current pointer 发布。
- 提供 `client.history.replay`：不改变 facts/reducer revision，默认从最早未完成快照
  恢复；`force` 才从指定区块重放。它用于中断恢复，不能替代 reducer 变更后的 rebuild。
- replace 的删除、重采集、upsert、cursor/affected replay 更新在同一个可回滚事务中；
  失败后不能留下被删除但未重写的空洞。`dryRun` 绝不能修改数据库。
- 同 user+chain 的 running rebuild 必须合并范围并返回 `busy`/`queued`/`running`，
  不能并行写同一组快照。无参数全库清空 API 禁止实现；reason 必须限长且脱敏。
- 修复流程是：离线 fixture -> `sync.audit` -> dryRun ->
  `recollect(strategy: "replace")` -> `history.rebuild`/等待 replay ->
  `getUserStateAtBlock` 与事实范围查询核对。

4. 价格 update 和查询

- update 输入 token 名称/符号/地址、exchange、market、quote、interval、fromTimestamp、
  toTimestamp。token 地址优先；symbol/name 歧义必须报 TOKEN_AMBIGUOUS，不能猜市场。
- 每次 update 只按时间范围向指定 exchange 请求它真实允许的最大数量；provider 的
  page token/page number 不能持久化。使用半开区间 [from,to)，以有效最后点 + interval
  推进 nextFromTimestamp。
- 空响应必须有可验证 covered range 或报 PROVIDER_STALLED，不能造成无限循环。points、
  price scope progress 和 run 状态一个事务提交；相同 timestamp 幂等 upsert。
- 价格保持 decimal/string 精度，按 exchange/market/quote/interval 分开，不跨来源
  自动平均或换算。返回 hasNext、nextFromTimestamp 和 covered range。
- 实现 getPriceAt/getPricesAt 等价能力：支持 before/after/nearest、最大距离、批量
  查询、等距时选择较早点；缺失返回 missing，不使用 0 或任意旧价格填充。

5. 历史回放

- update 的 replay flag 只在事实事务提交后排队回放；update 不被长时间回放阻塞。
  同一 user+chain 只能有一个 running replay，新的 changed range 要合并到现有 job。
  运行中再次 update 返回 history_replay_running 或 history_replay_queued，而不是
  启动第二个回放。
- 使用 lease、heartbeat、stale recovery 和可重试 job。facts 是唯一真相，派生状态
  和快照可以失效重建；以 facts revision + replay version 隔离旧结果。
- 事件按 block、transactionIndex、logIndex/traceIndex、identity 稳定排序；只在完整
  区块边界发布快照。默认每 10,000 个事件或 10,000 个区块先到即快照，阈值可配置。
- 最小 reducer 只计算已保存事实可推出的 raw token balances、转入/转出累计、native
  value/gas 统计、交易数和 warnings。不能声称已经实现完整 DeFi action/PnL。
- getUserStateAtBlock 从最近 <= block 的同 revision snapshot 重放到目标块；目标块大于
  已完成回放边界时返回 building/partial，不伪造 ready。getTokenFlowHistory 按区块范围
  返回精确 txHash/log/trace identity 的事实数据，并支持方向和稳定分页。

6. 测试和依赖

- 默认测试离线，使用 fake storage/fake provider/fake clock；不要为了测试读取环境文件
  或访问真实 API。
- 覆盖 SQLite/PostgreSQL storage contract、迁移、BigInt、租约、满页/单块边界、重复
  update、crash recovery、provider failure、价格 limit/gap/附近查询、回放排序/快照/
  revision/并发合并/reorg。
- 不新增 ethers、viem、第二套 HTTP client、第二套 retry loop、全局 singleton 或
  background health timer，除非先更新架构文档并取得批准。复用现有 provider adapter、
  RequestExecutor、BlockRangeScanner、cursor codec 和 transport seam。
- 新依赖只有在确认没有合适现有能力后加入；记录官方文档、固定版本、许可证和运行时
  约束。不要把 TypeORM/Nest 引入 SDK。

验证顺序：

  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm build
  pnpm test:package
  pnpm check

全部通过后再做可选 live smoke。live smoke 最多使用一个小地址和小区块/时间范围，
输出只允许 chainId、稳定 provider、counts、status、errorCode；绝不能输出 URL、key、
地址全量、价格、payload、SQL 或 cursor。最后检查 git diff --check，确认只修改了
任务文件，并同步 README、docs/SPEC.md、docs/ARCHITECTURE.md、docs/INTEGRATIONS.md、
docs/DECISIONS.md、docs/NEXT_SESSION.md 和本目录文档状态。

最终报告必须包含：

- 实际修改文件和每个 package 的完成状态；
- public API、迁移版本、driver 和兼容性说明；
- 测试/构建命令及结果；
- 未验证的 provider/数据库/性能风险；
- 仍需用户决定的问题。不要声称未运行的测试通过，也不要声称只写了文档却修改了
  源码。
```
