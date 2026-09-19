# Next Session Handoff (任务交接文档)

## 1. 当前基本信息
- **任务编号**: TASK-006 (已完成归档)
- **任务目标**: 将 CEX Token Price 相关服务提取为独立同构微内核 SDK 仓库（`token-price-sdk`，存储于 `/ssd0/git/token-price-nodejs`），支持跨平台（前端 IndexedDB、后端 SQLite、通用 In-Memory），并在 `EVM-Data-SDK` 中通过依赖与委托无缝集成。
- **当前状态**: `DONE` (Standby 待命)

## 2. 本次已交付工作
1. **独立仓库建立 (`/ssd0/git/token-price-nodejs`)**:
   - 远程仓库：`https://github.com/xzsean666/token-price-nodejs.git`，NPM 包名：`token-price-sdk`。
   - 完整工程化配置（`package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`）。
2. **同构跨平台与双引擎存储驱动**:
   - **后端 (Node.js)**：基于 Node 原生 `node:sqlite`（零 C++ 编译）与外置 SQL 转译适配器的 `SqlitePriceStorage`。
   - **前端 (Browser)**：基于浏览器原生 `IndexedDB` 与复合索引游标的 `IndexedDbPriceStorage`，支持毫秒级 $O(\log N)$ 时间戳临近检索（`before`, `after`, `nearest`）。
   - **内存驱动 (In-Memory)**：用于快速单测、SSR 的 `MemoryPriceStorage`。
   - 统一自动探测工厂 `createPriceStorage({ driver: "auto" })`。
   - 同构 HTTP 传输与流式解压缩（`AxiosHttpTransport`, `FetchHttpTransport`, `DecompressionStream`）。
3. **微内核服务群**:
   - `KlineBinaryCodec`：16 字节定长二进制编码器与二分切片检索。
   - `BinanceArchiveAdapter` & `GateArchiveAdapter`：历史归档包下载与解析。
   - `KlineArchiveManager`：支持磁盘与 Storage 双层缓存、并发锁定与 24h 过期清理。
   - `TokenSupportStore` & `TokenSupportService`：三层缓存与负缓存保护，1s 探活。
   - `UnifiedKlineService`：Binance 优先、Gate 降级、自然月归档+REST 自动缝合。
   - `PriceSyncService`：多交易所增量补全、断点记录与临近点定向插值。
   - `TokenPriceClient`：高层 API 统一封装。
4. **`EVM-Data-SDK` 依赖委托与彻底清理冗余 (ADR-041 & ADR-042)**:
   - 添加依赖 `"token-price-sdk": "link:../token-price-nodejs"`。
   - 所有价格模块、编解码器与存储接口全面委托并统一从 `token-price-sdk` 导出，保持 100% 顶层 API 与类型向后兼容。
   - 物理清理 46 个冗余实现、领域模型及单测文件（净删减 2,840 行冗余代码）。
   - 编写权威架构规范文档 `docs/TOKEN_PRICE_CONTEXT.md`，追加 ADR-041 与 ADR-042。

## 3. 验证结果
- `token-price-nodejs`:
  - 4 套测试（24 个测试用例全部通过，覆盖 SQLite、IndexedDB、Memory、Client）。
  - `pnpm typecheck`（0 错误），`pnpm build`（ESM, CJS, d.ts 打包成功）。
- `EVM-Data-SDK`:
  - `pnpm check` 全部通过：
    - `pnpm typecheck`（0 错误）
    - `pnpm lint`（0 警告）
    - `pnpm test`（38 个测试套件，372 个单测 100% 通过）
    - `pnpm build`（成功生成 ESM / CJS / d.ts）
    - `pnpm test:package`（Smoke 测试与 Consumer 验证通过）

## 4. 下一步任务建议 (Next Actions)
- 当前待命。系统已成功解耦两大微内核底座（`evm-call` 用于 EVM 链上 RPC / Multicall3，`token-price-sdk` 用于多交易所价格与 K 线服务），`EVM-Data-SDK` 完全移除了冗余代码，架构高度解耦、清晰健壮，随时可承接新的链上业务需求或发布 NPM 包。

