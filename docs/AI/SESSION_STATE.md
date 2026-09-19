# Current Session State (会话状态)

## 1. 当前基本信息

- **当前 Goal**: 将 CEX Token Price 相关能力独立提取为同构微内核 SDK `token-price-sdk`（存储于 `/ssd0/git/token-price-nodejs`），支持跨平台（前端 IndexedDB、后端 SQLite、内存驱动），并在 `EVM-Data-SDK` 中通过依赖与委托无缝集成（ADR-041 & TASK-006 已全部交付）。
- **当前 Task**: [TASK-006](tasks/TASK-006.md) 提取同构 CEX Token Price 微内核 SDK 并与 EVM-Data-SDK 集成。
- **当前状态**: `STANDBY` (已就绪并归档)

---

## 2. 代码库基线与最新交付成果总结 (Baseline State)

从仓库历史迭代提炼的最新交付成果：
1. **同构 CEX Token Price 微内核 SDK 提取与集成 (ADR-041 & TASK-006)**
   - 独立仓库：`/ssd0/git/token-price-nodejs`，远端 `https://github.com/xzsean666/token-price-nodejs.git`，NPM 包名 `token-price-sdk`。
   - **双存储驱动支持 (Dual Storage Engine)**：
     - 后端：基于 Node 22/24 原生 `node:sqlite`（零编译依赖）或外置通用 SQL 执行器的 `SqlitePriceStorage`。
     - 前端：基于浏览器原生 `IndexedDB` 与复合索引游标的 `IndexedDbPriceStorage`，支持毫秒级 $O(\log N)$ 时间戳临近检索（`before`, `after`, `nearest`）。
     - 内存驱动：`MemoryPriceStorage`，适用于 SSR、单元测试与临时计算。
     - 自动检测工厂：`createPriceStorage({ driver: "auto" })`。
   - **同构网络传输与解压缩**：
     - 双传输：`AxiosHttpTransport`（Node.js / 代理）与 `FetchHttpTransport`（浏览器 / Workers / 零依赖）。
     - 纯 Web API 解压：原生 `DecompressionStream("gzip")` 与 `DecompressionStream("deflate-raw")`，兼容浏览器与 Node.js 18+。
   - **16 字节定长二进制 K 线归档编解码 (`KlineBinaryCodec`)**：
     - 基于 `DataView`，单条 K 线 16 字节，支持 $O(\log N)$ 二分快速区间切片。
   - **Token 支持度检测与负缓存保护 (`TokenSupportStore` & `TokenSupportService`)**：
     - 内存 -> 存储 -> 1s 上游探活三级缓存，对确定性 400/404 执行负缓存保护，超时/5xx 绝不写库。
   - **多交易所历史与实时价格同步 (`PriceSyncService`)**：
     - 支持跨交易所、交易对断点续传、重采与方向性时间戳定向插值。
   - **EVM-Data-SDK 全面委托集成**：
     - `package.json` 添加 `"token-price-sdk": "link:../token-price-nodejs"`。
     - `KlineBinaryCodec`, `KlineArchiveManager`, `BinanceArchiveAdapter`, `GateArchiveAdapter`, `TokenSupportStore`, `TokenSupportService`, `UnifiedKlineService`, `PriceSyncService`, `TokenPriceClient`, `createTokenPriceClient`, `PriceStorage` 均由 `token-price-sdk` 提供，100% 保持向后兼容。
     - 43 个测试套件（397 个单元测试）100% 通过，`pnpm check` 验证全绿通过。
2. **EVM RPC 基座解耦与 `evm-call` 依赖集成 (ADR-038 & TASK-003)**
   - 依赖 `evm-call`（当前锁定 hash `d7a5c16d2bcbda6255d05f1f5b745eac88f699c0`），详见 `docs/EVM_CALL_CONTEXT.md`。
3. **存储层双引擎加固与 PostgreSQL 生产级优化 (ADR-040 & TASK-005)**
   - 默认 Node 24 原生 SQLite，可配置切换 PostgreSQL。
4. **多级阶梯退避冷却与告警 (Stepped Cooldown & Slack Alerting)**
   - `CooldownTracker` 实现 `1m -> 5m -> 15m -> 30m -> 1h -> 2h -> 4h -> 8h -> 12h -> 24h` 确定性退避。
5. **数据同步与统一全局 HTTP Proxy-Only 方案 (ADR-036)**
   - 统一纯轻量级 `ProxyPool`，代理模式下严格禁止 direct 直连。

---

## 3. 本次会话交付文件与变更概览

### 新建独立仓库 `/ssd0/git/token-price-nodejs`：
- `package.json`, `pnpm-workspace.yaml`, `tsconfig.json`, `tsconfig.build.json`, `tsup.config.ts`, `vitest.config.ts`, `README.md`
- `src/domain/` (errors, priceModels, klineModels, tokenSupportModels, priceSyncModels 等)
- `src/transport/` (HttpTransport, AxiosHttpTransport, FetchHttpTransport, decompression)
- `src/storage/` (PriceStorage, SqlitePriceStorage, IndexedDbPriceStorage, MemoryPriceStorage, createPriceStorage)
- `src/archive/` (KlineBinaryCodec, BinanceArchiveAdapter, GateArchiveAdapter, KlineArchiveManager)
- `src/services/` (PriceProviderRouter, PriceRequestExecutor, TokenPriceAggregator, TokenSupportStore, TokenSupportService, UnifiedKlineService, PriceSyncService)
- `src/client/` (TokenPriceClient, createTokenPriceClient)
- `tests/` (storage.test.ts, kline-binary-codec.test.ts, token-support.test.ts, client.test.ts - 共 24 个单测全部通过)

### `EVM-Data-SDK` 仓库修改 (ADR-041 & ADR-042 彻底清理冗余)：
- `package.json`：添加 `"token-price-sdk": "link:../token-price-nodejs"`
- `src/index.ts`：从 `token-price-sdk` 统一集中导出所有 price primitives、adapters、models、archive、sync services、client 与 storage 工厂，100% 保持对外 API 向后兼容
- `src/services/TokenService.ts`：更新为直接从 `token-price-sdk` 引用模型、请求规范化函数与服务类型
- `src/client/EvmDataClient.ts`：更新为直接从 `token-price-sdk` 引用各 Provider 适配器、路由、执行器与归档管理器
- `src/domain/configuration.ts`：引用 `token-price-sdk` 的 `TokenPriceProviderName`
- **物理清理 46 个冗余文件（净删除 2,840 行代码）**：
  - 删除 `src/providers/price/` 全部 21 个适配器与模型文件
  - 删除 `src/price/` 全部 12 个内部服务与归档文件
  - 删除 `src/storage/TokenSupportStore.ts` 临时 re-export 文件
  - 删除 `src/domain/` 下 7 个重复模型文件（`binanceKlineModels.ts`, `gateKlineModels.ts`, `klineModels.ts`, `priceModels.ts`, `priceOperations.ts`, `priceSyncModels.ts`, `tokenSupportModels.ts`）
  - 删除 `tests/unit/` 下 5 个重复单测文件（`kline-binary-codec.test.ts`, `kline-archive-manager.test.ts`, `gate-adapter.test.ts`, `token-support.test.ts`, `unified-kline-service.test.ts`）
- `tests/unit/token-price.test.ts`、`tests/unit/evm-data-sync-replay.test.ts`、`tests/unit/postgres-storage-contract.test.ts` 更新引用
- 全部 38 个测试套件（372 个单测）100% 通过，`pnpm check`（typecheck, lint, test, build, test:package）全绿通过
- `docs/TOKEN_PRICE_CONTEXT.md`：上下文与架构指导文档
- `docs/AI/DECISIONS.md`：新增 ADR-041 与 ADR-042
- `docs/NEXT_SESSION.md`：更新交接状态

