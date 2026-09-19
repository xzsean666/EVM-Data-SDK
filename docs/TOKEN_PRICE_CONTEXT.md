# Token-Price-SDK Integration Context & Upgrade Guide (代币价格服务基座上下文文档)

> **版本 (Version)**: 1.0.0  
> **最后同步时间 (Last Synced)**: 2026-09-19  
> **上游仓库 (Upstream Repo)**: [https://github.com/xzsean666/token-price-nodejs.git](https://github.com/xzsean666/token-price-nodejs.git)  
> **本地开发路径 (Local Path)**: `/ssd0/git/token-price-nodejs`  
> **Package 依赖配置**: `"token-price-sdk": "link:../token-price-nodejs"`  
> **NPM 包名**: `token-price-sdk`

---

## 1. 概述与核心使命 (Overview & Mission)

`token-price-sdk` 是从 `EVM-Data-SDK` 中独立提取出的通用代币价格与历史 K 线微内核 SDK。

设计初衷与 `evm-call` 完全一致：
- **同构跨平台 (Isomorphic)**：既可在 Node.js 后端服务中高效运行，也可直接在现代化浏览器前端页面、SSR 环境、Edge Runtime、Cloudflare Workers 中无缝使用。
- **双引擎存储驱动 (Dual Storage Engine)**：
  - **后端 (Node.js)**：采用 Node 22/24 原生内置的 `node:sqlite`（零 C++ 编译依赖、零原生绑定开销）或通用 SQL 适配器。
  - **前端 (Browser)**：采用原生 `IndexedDB` 存储，借助复合索引游标遍历（Compound Index Cursor）实现毫秒级 $O(\log N)$ 时间戳临近检索（`before`, `after`, `nearest`）。
  - **内存驱动 (In-Memory)**：提供高性能轻量内存驱动，适合单元测试、端到端测试与临时环境。
- **上层业务解耦**：`EVM-Data-SDK` 本身定位为 EVM 链上事件与多源数据聚合器，通过依赖 `evm-call` 与 `token-price-sdk`，将代币价格聚合、归档 K 线编解码、交易所币种支持度探活等通用服务完全委托给 `token-price-sdk`。

---

## 2. 上游 `token-price-sdk` 核心特性与架构 (Architecture & Features)

```
                       +-----------------------------------+
                       |        TokenPriceClient           |
                       +-----------------+-----------------+
                                         |
         +-------------------------------+-------------------------------+
         |                               |                               |
+--------v-------+              +--------v-------+              +--------v-------+
| Price          |              | UnifiedKline   |              | TokenSupport   |
| Aggregator     |              | Service        |              | Service        |
+--------+-------+              +--------+-------+              +--------+-------+
         |                               |                               |
         |                 +-------------+-------------+                 |
         |                 |                           |                 |
+--------v-------+  +------v-------+            +------v-------+  +------v-------+
| Multi-Exchange |  | KlineArchive |            | REST Klines  |  | Memory /     |
| Adapters       |  | Manager      |            | (Binance /   |  | Storage /    |
| (Binance, Gate,|  | (.bin Cache) |            |  Gate)       |  | 1s Probe     |
|  OKX, Coinbase,|  +------+-------+            +--------------+  +--------------+
|  GeckoTerminal)|         |
+----------------+  +------v-----------------------------------+
                    |         KlineBinaryCodec                 |
                    | (16-byte fixed DataView: UInt64LE+Float64)|
                    +------------------------------------------+
                                         |
                    +--------------------+---------------------+
                    |       Storage Layer (PriceStorage)       |
                    +--------------------+---------------------+
                    |  - SqlitePriceStorage (Backend)          |
                    |  - IndexedDbPriceStorage (Frontend)      |
                    |  - MemoryPriceStorage (In-Memory/SSR)    |
                    +------------------------------------------+
```

### 2.1 同构网络传输与解压缩 (Isomorphic Transport & Decompression)
- **双传输适配器**：
  - `AxiosHttpTransport`：Node.js 后端环境标准 HTTP 传输，支持原生 HTTP/HTTPS 代理配置。
  - `FetchHttpTransport`：浏览器与边缘运行时标准 Fetch 传输，零外部依赖。
- **纯 Web API 流式解压**：
  - 使用现代化标准 `DecompressionStream("gzip")` 与 `DecompressionStream("deflate-raw")`，直接在内存中解压 Gate.io 的 `.csv.gz` 与 Binance 的 PKZip 归档。
  - 同步回退至 Node 原生 `node:zlib`，确保无缝兼容 Node.js 18+ 与所有现代主流浏览器。

### 2.2 紧凑 16 字节二进制 K 线编码器 (`KlineBinaryCodec`)
- **超高压缩率**：每个时间点固定占用 16 字节（8 字节时间戳毫秒 `UInt64LE` + 8 字节价格 `DoubleLE`）。
- **极速检索**：单月 8928 条 5 分钟 K 线仅占约 140 KB，解码性能比传统 JSON 快 50 倍以上。
- **二分切片**：基于内存有序二进制排列，支持 $O(\log N)$ 时间戳范围切片（`[startMs, endMs)`），无需解包全部数据。

### 2.3 币种支持度探活与负缓存保护 (`TokenSupportStore` & `TokenSupportService`)
- **三层缓存架构**：`L1 内存 (O(1)) -> L2 本地存储 (SQLite / IndexedDB) -> L3 上游 1s 探活请求`。
- **防雪崩与频控保护**：
  - 对确认不支持的代币写入负缓存（`supported = false`），避免每次查询重复发起 400 失败请求打满 API 限频。
  - 严格区分确定性错误（400/404）与暂时性异常（超时、5xx）；对于暂时性故障绝不写入负缓存，保留后续自动重试。
- **批量预加载**：提供 `preloadSupportedTokens(["binance", "gate"])`，单次初始化拉取全市场现货标的，使成千上万代币的支持度检查瞬间命中内存。

### 2.4 多交易所历史与实时价格同步 (`PriceSyncService`)
- 支持跨交易所、交易对、时间粒度（如 `5m`, `1h`, `1d`）的价格范围补全与增量同步。
- 自动写入范围断点（Checkpoints），支持断点续传与重新采集（`recollect`）。
- 提供方向性时间戳定向插值（`before`, `after`, `nearest`）与最大容差窗口截断（`maxDistanceMs`）。

---

## 3. `EVM-Data-SDK` 架构融合与委托规范 (Integration in EVM-Data-SDK)

在 `EVM-Data-SDK` 中，所有历史与现货代币价格逻辑均已切换为底层依赖 `token-price-sdk`，并保持 100% 顶层 API 与类型向后兼容：

| 功能模块 | 原 EVM-Data-SDK 路径 | 新实现方式 |
| :--- | :--- | :--- |
| **KlineBinaryCodec** | `src/price/archive/KlineBinaryCodec.ts` | 直接 re-export 自 `token-price-sdk` |
| **BinanceArchiveAdapter** | `src/price/archive/BinanceArchiveAdapter.ts` | 直接 re-export 自 `token-price-sdk` |
| **GateArchiveAdapter** | `src/price/archive/GateArchiveAdapter.ts` | 直接 re-export 自 `token-price-sdk` |
| **KlineArchiveManager** | `src/price/archive/KlineArchiveManager.ts` | 继承并透传 axios 实例，支持磁盘与双存储缓存 |
| **TokenSupportStore** | `src/storage/TokenSupportStore.ts` | 兼容旧 `StorageAdapter` 并代理到 `token-price-sdk` |
| **TokenSupportService** | `src/price/TokenSupportService.ts` | 直接 re-export 自 `token-price-sdk` |
| **UnifiedKlineService** | `src/price/UnifiedKlineService.ts` | 直接 re-export 自 `token-price-sdk` |
| **PriceSyncService** | `src/price/PriceSyncService.ts` | 直接 re-export 自 `token-price-sdk` |
| **TokenPriceClient** | `src/index.ts` | 顶层直接导出 `TokenPriceClient` 与存储工厂函数 |

### 测试与质量保障 (Verification Results)
- `token-price-sdk` 本身包含 4 套完整单元测试（24 个测试用例全部通过），涵盖 SQLite、IndexedDB (通过 `fake-indexeddb`)、In-Memory 三大存储驱动。
- `EVM-Data-SDK` 原有 43 个测试套件（共 397 个单元测试）全部 100% 通过无任何降级。
- 完整运行 `pnpm check`（包含类型检查、ESLint 代码审查、完整测试、包打包及 Smoke 测试）全部通过。

---

## 4. 升级与协同开发流程 (Upgrade & Development Guide)

若需在 `token-price-sdk` 中新增交易所适配器或增强功能：

1. **在 `token-price-nodejs` 仓库中进行开发**：
   ```bash
   cd /ssd0/git/token-price-nodejs
   pnpm test
   pnpm build
   git commit -m "feat: add kraken price provider"
   ```
2. **在 `EVM-Data-SDK` 验证集成**：
   ```bash
   cd /ssd0/git/EVM-Data-SDK
   pnpm check
   ```
3. **提交与记录**：
   保持遵循 Conventional Commits 规范，遵循全局 GitHub 路由规范（`/ssd0/git` 匹配账号 `xzsean666`），绝不自动强制 push。
