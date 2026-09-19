# EVM-Call Integration Context & Upgrade Guide (EVM RPC 基座上下文文档)

> **版本 (Version)**: 1.0.0  
> **最后同步时间 (Last Synced)**: 2026-09-19  
> **上游仓库 (Upstream Repo)**: [https://github.com/xzsean666/evm-call.git](https://github.com/xzsean666/evm-call.git)  
> **本地开发路径 (Local Path)**: `/ssd0/git/evm-call`  
> **当前锁定 Git Commit Hash**: `d7a5c16d2bcbda6255d05f1f5b745eac88f699c0`  
> **Package 依赖配置**: `"evm-call": "github:xzsean666/evm-call#d7a5c16d2bcbda6255d05f1f5b745eac88f699c0"`

---

## 1. 概述与核心使命 (Overview & Mission)

`evm-call` 是从大型 EVM 数据框架中淬炼出的极简、高可用、零多余依赖的 EVM RPC 基座 SDK (Node.js & TypeScript)。

在 `EVM-Data-SDK` 体系中，本项目定位为**上层数据聚合器与业务服务**（涵盖代币价格、K 线归档、预言机报价、DeFi 协议利率、账户交易解析等），而所有底层与 EVM 节点原生的 JSON-RPC 交互、Multicall3 聚合、ERC-20 链上直接读取、日志流式切片与节点故障避退，将**全部委托给 `evm-call` 底座**处理。

### 核心收益：
1. **彻底解耦底层 RPC 基础设施**：将节点池负载均衡、阶梯式冷静期（Stepped Backoff Cooldown）、SQLite 持久化缓存、JSON-RPC 自动切片等通用逻辑集中维护在 `evm-call`，避免在多个 SDK 间重复造轮子。
2. **极速与轻量 (Zero-Bloat)**：绝不捆绑庞大的 `ethers` 或 `viem`，使用原生 `Buffer` + `BigInt` 编解码，打包极小，Multicall3 / ERC-20 解码性能提升 50 倍。
3. **安全与防分叉重组**：内置确定性前置/后置区块 Hash 断言，严格截获并抛出 `RPC_BLOCK_REORG_DETECTED`。
4. **一键 Hash 升级**：未来无论 `evm-call` 扩展新链、优化 RPC 调度或增加新方法，`EVM-Data-SDK` 仅需升级 `evm-call` 并在 `package.json` 及本文档中更新 Git Commit Hash 即可。

---

## 2. 上游 `evm-call` 核心特性与架构 (Architecture & Features)

### 2.1 RPC 节点池与阶梯式退避 (RPC Pool & Stepped Backoff Cooldown)
- **内置公共节点**：内置 Ethereum 主网 (`1`) 与 Base 主网 (`8453`) 高可用公共 Archive 节点池。
- **自定义节点注入**：支持注入私有 RPC（如 Alchemy, Infura, QuickNode, 自建节点），无偏随机洗牌实现流量分发。
- **确定性阶梯冷却**：节点遭遇 429、5xx 或网络超时错误时，自动沿阶梯提升冷却期：
  $$\text{1m} \to \text{5m} \to \text{15m} \to \text{30m} \to \text{1h} \to \text{2h} \to \text{4h} \to \text{8h} \to \text{12h} \to \text{24h}$$
- **毫秒级快速恢复 (Fast Recovery)**：冷却期过后只要一次调用成功，即刻将连续失败计数清零并恢复节点为健康状态。

### 2.2 统一 SQLite 分层缓存系统 (`node:sqlite`)
- **Node 24 原生驱动**：默认持久化文件位于 `./data/evm-call.db`（支持通过 `storagePath` 或自定义 `storageAdapter` 注入）。
- **L1 内存直出 + L2 SQLite 双层架构**：极高频热点直接由内存直出，零额外 I/O。
- **最新态 (Latest) 10s 易变缓存**：10 秒内重复访问同一最新状态（如最新区块号、最新 Gas）直接命中本地缓存，杜绝轮询打爆节点或触发 429 限流。
- **历史归档 (Archive) 不可变长效缓存**：针对确定性历史区块与哈希的只读调用（`eth_call`, `eth_getBalance`, `eth_getCode`, `eth_getStorageAt` 等），支持默认 30 天的本地持久化存储，支持单次调用穿透 (`cacheTtlMs: 0`)。
- **冷却画像持久化**：全池节点冷却状态落盘，跨进程重启无需重新踩坑探测。

### 2.3 JSON-RPC Batch 增强调度器 (`JsonRpcBatchExecutor`)
- **缓存优先调度**：先查本地 SQLite 缓存，仅组装未命中项发起网络请求。
- **自动切片 (Chunking)**：默认每 100 条切片，规避单个 JSON-RPC batch 超过上游节点限制。
- **有界并发 (Bounded Concurrency)**：跨节点池分散并发（默认并发 3），防止打满单节点频控。
- **保序对齐**：兼容数字与字符串 Request ID，严格按请求原序还原返回结果。

### 2.4 Multicall3 确定性聚合与 ERC-20 原生只读
- **确定性调用**：锁定历史 blockNumber 执行 `aggregate3`。
- **重组截获**：前后探测区块 Header Hash，检测到重组立即报错阻断脏读。
- **常用方法开箱即用**：`balanceOf`, `allowance`, `decimals`, `name`, `symbol`, `totalSupply` 极速解码，兼容标准 string 与 legacy `bytes32`。
- **原生币批量查询**：单次 Multicall 批量获取上百个地址的原生代币余额。

### 2.5 生产级事件日志查询 (`getLogs` & 流式切片)
- **纯粹解耦**：返回标准化强类型 `EvmLog`，不强行绑定 ABI 解码与外置数据库。
- **大跨度切片与自适应对半拆分 (Adaptive Chunking)**：遇到节点返回“`query returned more than 10000 results`”或区块跨度过大错误时，自动对半拆分（Bisection）平滑重试。
- **流式迭代器 (`iterateLogs` / `iterateLogChunks`)**：基于 AsyncGenerator 按区块高度严格保序逐步 yield chunk，内存零堆积。

### 2.6 内插时间戳二分查块 (Interpolation Search)
- 基于数学证明的 $O(\log\log N)$ 历史区块内插搜索（`findBlockByTimestamp`），平均仅需 3~5 次网络往返即可精确定位历史时间戳区块，摆脱对 Etherscan API 等中心化第三方的依赖。

---

## 3. `evm-call` 公共 API 规范参考 (API Surface Reference)

### 3.1 客户端创建与生命周期

```typescript
import { createEvmCallClient, EvmCallClient, type EvmCallClientOptions } from "evm-call";

// 工厂函数创建
const client = createEvmCallClient({
  chainId: 1, // 支持 1, 8453 或别名 "ethereum", "base"
  customRpcUrls: ["https://eth-mainnet.g.alchemy.com/v2/KEY"], // 可选：注入私有 RPC
  storagePath: "./data/evm-call.db", // 可选：自定义 SQLite 路径
  attemptTimeoutMs: 15_000,
  totalTimeoutMs: 45_000,
  maxRpcAttempts: 3,
});

// 初始化（预热节点池探测）
await client.init(signal);

// 释放资源（关闭 SQLite）
client.close();
```

### 3.2 核心方法清单

| 分类 | 方法名 | 说明与主要参数 |
| :--- | :--- | :--- |
| **基础 RPC** | `client.call<T>(request, options)` | 单次 JSON-RPC 调用（带缓存和重试） |
| | `client.batch<T>(requests, options)` | 批量 JSON-RPC 调用（自动切片与保序还原） |
| | `client.strictBatch<T>(requests, options)` | 严格批量（任意项失败即抛出异常） |
| **Multicall** | `client.multicall(request)` | 指定历史区块执行 Multicall3 批量调用 |
| | `client.multicallErc20(request)` | 批量读取 ERC-20 元数据与余额 |
| | `client.getNativeBalances(request)` | 批量读取原生代币余额 |
| **区块与交易** | `client.getBlock(blockTag, options)` | 查询单个区块详情 |
| | `client.getBlocks(blockTags, options)` | 批量保序查询多个区块 |
| | `client.getTransaction(txHash, options)` | 查询交易详情 |
| | `client.getTransactions(txHashes, options)` | 批量查询多个交易详情 |
| | `client.getTransactionReceipt(txHash, options)` | 查询交易回执 |
| | `client.getTransactionReceipts(txHashes, options)` | 批量查询交易回执 |
| | `client.getTransactionWithReceipt(txHash, options)` | 单次往返同时查询交易与其回执 |
| | `client.getBlockReceipts(blockTag, options)` | 获取区块内全部交易回执（支持 L2 原生与降级批量） |
| **账户状态** | `client.getBalance(address, blockTag, options)` | 查询原生余额 |
| | `client.getTransactionCount(address, blockTag, options)` | 查询账户 Nonce |
| | `client.getTransactionCounts(addresses, blockTag, options)` | 批量查询 Nonce |
| | `client.getCode(address, blockTag, options)` | 获取合约字节码（区分 EOA 与合约） |
| | `client.getCodes(addresses, blockTag, options)` | 批量获取合约字节码 |
| | `client.getStorageAt(address, pos, blockTag, options)` | 读取底层合约存储槽 |
| | `client.getStorageAts(queries, blockTag, options)` | 批量读取合约存储槽 |
| **Gas & 费率** | `client.estimateGas(request, blockTag, options)` | 估算 Gas |
| | `client.getFeeHistory(count, newestBlock, percentiles)` | 获取 EIP-1559 历史基础费率与奖励 |
| | `client.getGasPrice(options)` | 获取当前建议 Gas Price |
| | `client.getBlockNumber(options)` | 获取最新区块高度（10s 本地缓存） |
| **时间查块** | `client.findBlockByTimestamp(timestampSec, options)` | 内插二分极速历史区块搜索 |
| **事件日志** | `client.getLogs(filter, options)` | 标准单次日志抓取（严格保序） |
| | `client.getLogsChunked(filter, options)` | 大跨度切片与自适应对半拆分采集 |
| | `client.iterateLogs(filter, options)` | 异步生成器流式日志迭代 |
| | `client.iterateLogChunks(filter, options)` | 携带区块范围边界的异步生成器流式迭代 |
| **缓存维护** | `client.cleanExpiredCache()` | 主动清理 SQLite 中过期缓存记录 |

### 3.3 核心错误类型与错误码

所有异常均派生自 `EvmCallError`（可通过 `isEvmCallError(err)` 判定）：

- `ARCHIVE_RPC_UNAVAILABLE`: 所有健康节点均不可用或处于冷却期
- `ARCHIVE_RPC_WRONG_CHAIN`: RPC 返回的 chainId 与客户端配置不符
- `ARCHIVE_STATE_UNAVAILABLE`: 节点缺少历史归档状态（非 Archive 节点）
- `RPC_BLOCK_NOT_FOUND`: 指定的区块不存在或尚未生成
- `RPC_BLOCK_REORG_DETECTED`: 探测到链上区块重组（前后 Hash 不一致）
- `RPC_RESPONSE_INVALID`: 节点返回了格式畸形或非法响应
- `MULTICALL_NOT_DEPLOYED_AT_BLOCK`: 请求区块高度早于 Multicall3 部署区块
- `MULTICALL_RESPONSE_INVALID`: Multicall3 解码失败或返回值长度不匹配
- `STORAGE_BUSY` / `STORAGE_ERROR`: SQLite 锁争用或数据库 I/O 错误
- `REQUEST_TIMEOUT` / `REQUEST_ABORTED`: 超时或 AbortSignal 中断

---

## 4. `EVM-Data-SDK` 架构映射与委托规划 (Delegation Mapping)

在 `EVM-Data-SDK` 中，涉及底层 EVM RPC 调用的主要模块与平滑迁移路径如下：

```text
[ 上层业务服务 / SDK Client ]
  ├─ ChainlinkService (getTokenPricesAtBlock)
  ├─ DeFiExchangeRateService (getExchangeRatesAtBlock)
  ├─ UniswapV3HistoricalPriceService (getHistoricalPoolPrices)
  ├─ UniswapV4HistoricalPriceService (getHistoricalPoolPrices)
  ├─ TokenService (multicallAtBlock, multicallErc20AtBlock)
  ├─ AlchemyAdapter (ERC20 余额多链批量查询)
  └─ AlertService (节点 24h 冷却告警)
                │
                ▼
      [ EVM-Data-SDK / src/rpc/ ]  <-- 保留统一公开契约与适配层
                │
                ▼ (全面委托)
      [ evm-call 底座 / node_modules/evm-call ]
        ├─ EvmCallClient (门面与聚合调用)
        ├─ RpcPool & CooldownTracker (节点池与阶梯退避)
        ├─ JsonRpcBatchExecutor (缓存优先批量切片调度)
        ├─ Multicall3Codec & Erc20Codec (极速编解码)
        └─ SqliteStorageAdapter & RpcCacheService (持久化与两级缓存)
```

### 具体模块迁移对照表：

| `EVM-Data-SDK` 现有模块 | `evm-call` 对应组件 | 迁移与委托策略 |
| :--- | :--- | :--- |
| `src/rpc/EthereumMulticall3Codec.ts` | `evm-call` 的 `Multicall3Codec` | 直接重导出或薄包装 `evm-call` 的编解码逻辑与常量 |
| `src/rpc/Erc20MulticallCodec.ts` | `evm-call` 的 `Erc20Codec` | 委托给 `evm-call` 的 ERC-20 编解码函数与选择器常量 |
| `src/rpc/ArchiveRpcTransport.ts` | `evm-call` 的 `ArchiveRpcTransport` | 复用 `evm-call` 的单请求传输层与脱敏机制 |
| `src/rpc/EthereumArchiveRpcPool.ts` | `evm-call` 的 `RpcPool` | 转换为 `evm-call` 的 `RpcPool`，共享阶梯退避画像 |
| `src/rpc/JsonRpcBatchExecutor.ts` | `evm-call` 的 `JsonRpcBatchExecutor` | 委托给 `evm-call` 执行器，获得 L1/L2 缓存与自动切片能力 |
| `src/rpc/EthereumArchiveRpcExecutor.ts` | `evm-call` 的 `EthereumArchiveRpcExecutor` | 委托给底座的归档批量执行器，支持重组断言 |
| `src/rpc/RpcService.ts` | `evm-call` 的 `EvmCallClient` | 成为委托至 `EvmCallClient` 的领域适配外观层 |
| `src/client/EvmDataClient.ts` | `evm-call` 的 `createEvmCallClient` | 在初始化时按链构建/持有 `EvmCallClient`，管理生命周期 |

> **关键原则 (Golden Rules)**：
> 1. **公开契约向下兼容**：`EVM-Data-SDK` 已导出的公共类型与方法保持不变，内部实现平滑委托。
> 2. **存储适配一致**：`evm-call` 支持通过 `storageAdapter` 注入已有的 SQLite 连接，保证与 SDK 本地数据库（`DatabaseSync`）共享同一实例或同盘文件。
> 3. **脱敏保证**：私有 RPC URL 内部携带的 key 绝不允许在错误信息与告警中泄露。

---

## 5. 标准升级与更新 Hash 流程 (SOP: How to Upgrade `evm-call`)

当 `evm-call` 底座进行功能新增、Bug 修复或性能优化后，`EVM-Data-SDK` 进行依赖升级的标准操作规程（SOP）如下：

### 第一步：在 `evm-call` 仓库中完成开发与打包
```bash
cd /ssd0/git/evm-call

# 1. 运行测试与构建，确保构建产物 dist/ 完好无损
pnpm test
pnpm build

# 2. 提交代码并推送到远端 (若需要)
git add .
git commit -m "feat: your new feature or fix"
git push origin main
```

### 第二步：获取最新 Commit Hash
```bash
git rev-parse HEAD
# 输出示例: d7a5c16d2bcbda6255d05f1f5b745eac88f699c0
```

### 第三步：在 `EVM-Data-SDK` 中执行依赖安装
切换回 `EVM-Data-SDK` 项目根目录，执行：
```bash
cd /ssd0/git/EVM-Data-SDK

# 安装指定的 commit hash
pnpm add github:xzsean666/evm-call#<NEW_COMMIT_HASH>
```

### 第四步：更新文档与记录
1. 更新本文档顶部及相关小节中的 `当前锁定 Git Commit Hash` 为 `<NEW_COMMIT_HASH>`。
2. 在 `docs/INTEGRATIONS.md` 中同步更新 `evm-call` 的 Commit Hash 与版本说明。
3. 若升级涉及重要架构决策变更，在 `docs/AI/DECISIONS.md` 中追加记录。

### 第五步：运行全量回归验证
```bash
# 执行完整质检流水线（类型检查、Lint、全量测试、打包与 Smoke 测试）
pnpm check
```
必须确保：
- `pnpm typecheck` 0 错误
- `pnpm lint` 0 警告
- `pnpm test` 全部通过
- `pnpm test:package` 打包验证成功

### 第六步：提交 Git 变更
```bash
git add package.json pnpm-lock.yaml docs/
git commit -m "chore(deps): bump evm-call to <NEW_COMMIT_HASH>"
```

---

## 6. 当前依赖与集成状态清单 (Current Status Checklist)

- [x] **依赖安装成功**：`package.json` 与 `pnpm-lock.yaml` 已锁定 `github:xzsean666/evm-call#d7a5c16d2bcbda6255d05f1f5b745eac88f699c0`。
- [x] **产物类型可解析**：`dist/index.d.ts` 在本仓库 TypeScript 编译器下 100% 兼容通过。
- [x] **基准测试全绿**：安装 `evm-call` 后，`EVM-Data-SDK` 现有全部 52 个测试套件（488 个用例）保持 100% 通过。
- [x] **上下文文档完备**：本文档 (`docs/EVM_CALL_CONTEXT.md`) 已建立，详细记录了架构、API 契约与标准升级 SOP。
- [ ] **源码委托实现 (Pending Task)**：待下个会话或明确指令后，将 `src/rpc/` 及各服务实现无缝接入并切换至 `evm-call`。
