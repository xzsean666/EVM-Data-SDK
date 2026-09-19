# Current Session State (会话状态)

## 1. 当前基本信息

- **当前 Goal**: 将所有与 EVM RPC 的底层交互委托至 `/ssd0/git/evm-call` 基座，建立 Context 文档并固化基于 Git Hash 的平滑升级机制，彻底清理项目内冗余老代码与垫片。
- **当前 Task**: [TASK-003](tasks/TASK-003.md) 引入 `evm-call` Git 依赖、生成 Context 规范文档、彻底清理 20 个冗余文件。
- **当前状态**: `DONE` (Standby 待命)

---

## 2. 代码库基线与已交付功能总结 (Baseline State)

从仓库历史迭代与 `NEXT_SESSION.md` 提炼的最新交付成果：
1. **EVM RPC 基座解耦与 `evm-call` 依赖集成 (ADR-038 & TASK-003)**
   - 通过 `pnpm add github:xzsean666/evm-call#d7a5c16d2bcbda6255d05f1f5b745eac88f699c0` 成功集成底座依赖。
   - 建立权威规范文档 `docs/EVM_CALL_CONTEXT.md`，详尽记录 `evm-call` 的架构特征、API 规范、错误码、与 SDK 内部模块的委托映射表以及未来升级更新 Hash 的标准操作规程 (SOP)。
   - 更新 `docs/INTEGRATIONS.md` 与 `docs/AI/DECISIONS.md` (ADR-038)。
   - **彻底物理删除 20 个冗余文件**（8 个 rpc 胶水垫片、3 个重复模型文件、9 个重复底层单测，净精简 ~4,500 行代码）。
   - `EthereumArchiveRpcPool` 瘦身为 28 行继承自 `RpcPool` 的兼容薄层；`src/index.ts` 直接 re-export `evm-call`，保证 100% 向下兼容。
2. **多级阶梯退避冷却与告警 (Stepped Cooldown & Slack Alerting)**
   - `CooldownTracker` 实现 `1m -> 5m -> 15m -> 30m -> 1h -> 2h -> 4h -> 8h -> 12h -> 24h` 确定性退避。
   - `EthereumArchiveRpcPool`（底层委托 `evm-call` `RpcPool`）与 `CredentialPool` 全面接入退避熔断机制。
   - `SlackWebhookReporter` 与 `AlertService` 实现 24 小时聚合静默告警与敏感信息脱敏。
   - `CooldownStore` 基于 Node 24 原生 SQLite 实现本地跨进程持久化。
3. **多链 Archive RPC 与 Multicall3 基础能力**
   - 提取并暴露通用、ABI 无关的 `client.token.getMulticallAtBlock()` 与 `client.rpc.multicallAtBlock()`。
   - 支持 ERC-20 标准接口批量回溯读取 `client.token.multicallErc20AtBlock()`。
   - 内置 Ethereum 及 Base 链的 Archive RPC 节点池探测、随机绑定与失败重试机制（由 `evm-call` 提供）。
4. **DeFi 兑换率快照 (DeFi Exchange Rate Snapshot)**
   - 支持以太坊和 Base 链主流 DeFi 协议（LST、Aave V2/V3 aTokens、Compound V2 cTokens、ERC-4626 借贷池、LP 池）的精确区块兑换率计算。
5. **历史价格服务与聚合器**
   - 支持 Uniswap V3 与 Uniswap V4 精确区块价格读取。
   - 支持 Binance, OKX, Gate, Coinbase, GeckoTerminal 日线历史价格聚合与降级。
   - 新增 `GateAdapter`，提供现货交易对 tradable 探测、日线 180 天分片采集与异常归一化。
6. **数据同步与统一全局 HTTP Proxy-Only 方案**
   - 彻底移除 sing-box 本地子进程运行时与 VLESS/VMESS/SS 协议解析。
   - 统一采用纯轻量级的 `ProxyPool` 调度标准 HTTP/HTTPS 代理。
   - 确立全局 Proxy-Only 规范：代理模式下严格禁止 direct 直连（`allowDirect: false`），无代理可用时快速失败返回脱敏 `PROXY_ERROR`。
   - 支持自适应区块区间的 ERC-20 与交易流式分片读取 (`BlockRangeScanner`)。
7. **Token 支持度检测与确定性 SQLite 缓存**
   - `TokenSupportService` 实现内存缓存 + SQLite 持久化 + 1s 严格超时探活（确定性 200/400/404 缓存，超时/网络错误/5xx 绝不写库）。
   - 支持 `preloadSupportedTokens` 批量预载 Binance 与 Gate 交易对至内存。
8. **统一定长二进制历史归档与 Kline 聚合服务 (ADR-037)**
   - `KlineBinaryCodec` 实现 16 字节紧凑定长二进制文件 (`.bin`) 存储（UInt64LE 毫秒时间戳 + DoubleLE 价格），单月 5m 数据仅 ~138 KB，支持 $O(\log N)$ 二分快速区间切片。
   - `KlineArchiveManager` 依托纯 Node.js 内置 `zlib` 解压 Binance ZIP 与 Gate CSV.GZ 归档包，通过 `AsyncLock` 保证单并发下载，24 小时 TTL 磁盘缓存并自动清理过期文件。
   - `UnifiedKlineService` 实现按自然月月初自动切分（历史月归档 + 当月 REST API），合并去重并统一暴露 `getKlines` 与 `getKlinesPrices`（严格 Binance 优先，Gate 次之）。
9. **模块化 Examples 示例体系**
   - `examples/` 目录下提供 11 个独立模块文件与 `common.ts`、`README.md`。

---

## 3. 本次会话物理删除与修改的文件

### 物理删除的文件 (共 20 个):
- `src/domain/jsonRpcModels.ts`
- `src/domain/erc20MulticallModels.ts`
- `src/domain/rpcModels.ts`
- `src/rpc/ArchiveRpcTransport.ts`
- `src/rpc/Erc20MulticallCodec.ts`
- `src/rpc/EthereumArchiveRpcExecutor.ts`
- `src/rpc/EthereumMulticall3Codec.ts`
- `src/rpc/JsonRpcBatchExecutor.ts`
- `src/rpc/RandomSource.ts`
- `src/rpc/builtinBaseArchiveRpcs.ts`
- `src/rpc/builtinEthereumArchiveRpcs.ts`
- `tests/unit/archive-rpc-transport.test.ts`
- `tests/unit/builtin-base-archive-rpcs.test.ts`
- `tests/unit/builtin-ethereum-archive-rpcs.test.ts`
- `tests/unit/erc20-multicall.test.ts`
- `tests/unit/ethereum-archive-rpc-executor.test.ts`
- `tests/unit/ethereum-archive-rpc-pool.test.ts`
- `tests/unit/json-rpc-batch-executor.test.ts`
- `tests/unit/multicall3-codec.test.ts`
- `tests/unit/random-source.test.ts`

### 修改的文件：
- `src/rpc/EthereumArchiveRpcPool.ts`（简化为 28 行薄层，继承 `evm-call` 的 `RpcPool`）
- `src/rpc/RpcService.ts`（直接导入 `evm-call` 编解码器与模型）
- `src/index.ts`（直接 re-export `evm-call` 导出的所有 RPC 原语与类型）
- `src/client/EvmDataClient.ts`（直接使用 `evm-call` 原语）
- `src/defi/*`、`src/services/*`、`src/providers/alchemy/*`、`src/alert/*`（改为直接导入 `evm-call`）
- `tests/unit/*`（同步更新导入路径与类型）
- `docs/NEXT_SESSION.md`、`docs/AI/SESSION_STATE.md`
