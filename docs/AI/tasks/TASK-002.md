# TASK-002: Token 支持度检测、Kline 优先级聚合与统一归档缓存系统

## 1. 任务基本信息

- **Task ID**: TASK-002
- **状态**: `DONE`
- **关联模块**: `src/price/`, `src/storage/`, `src/services/TokenService.ts`, `src/client/EvmDataClient.ts`
- **架构决策**: ADR-037
- **创建时间**: 2026-09-19
- **完成时间**: 2026-09-19

---

## 2. 目标与验收标准 (Acceptance Criteria)

1. **Token 支持度检测与 SQLite 缓存 (`TokenSupportService`)**：
   - 暴露 `client.token.isTokenSupported(token, provider)` 与 `client.token.getTokenSupport(token)`。
   - 检查优先级：内存缓存 -> SQLite 持久化表 `sdk_token_support` -> 上游探活（严格 1s 超时）。
   - 探活确定性结果（Binance `TRADING` / Invalid symbol，Gate `tradable` / 404）写入 SQLite 和内存。
   - 探活异常（超时、网络断开、5xx）**绝不写入 SQLite**。
   - 提供 `client.token.preloadSupportedTokens()` 一键预载所有现货交易对到内存。
2. **K 线查询优先级与统一接口 (`getKlines` / `getKlinesPrices`)**：
   - 暴露 `client.token.getKlines(request)` 与 `client.token.getKlinesPrices(request)`。
   - 交易所优先级：严格 Binance 优先，其次 Gate。
   - 两者皆不支持时明确抛出 `TOKEN_NOT_FOUND`。
3. **自然月前历史归档包下载与统一定长二进制缓存 (`KlineArchiveManager`)**：
   - 针对早于当前自然月（`< YYYY-MM-01 00:00:00 UTC`）的数据，走交易所官方月度归档包，禁止走 RESTful API。
   - 全局单并发下载锁（`AsyncLock`），强制“一次下载一个”。
   - 统一转存为标准 16 字节定长二进制文件 (`.bin`)：
     - `timestamp_ms` (UInt64LE, 8 bytes) + `price_usd` (DoubleLE, 8 bytes)。
     - 抹平各交易所压缩格式（ZIP vs GZ）、时间单位（毫秒 vs 秒）、列顺序差异。
     - 查询时通过 `O(log N)` 二分查找毫秒级切片，零解压、零字符串解析开销。
   - 1 天（24 小时）磁盘缓存 TTL，读取时自动清理 `now - mtime > 86_400_000` 的过期文件。
   - 跨自然月无缝拼接：任意时间区间自动分流归档月与当月 REST API，合并去重排序后返回。

---

## 3. 验证结果

- `pnpm typecheck`: 通过（0 错误）。
- `pnpm lint`: 通过（0 警告，0 错误）。
- `pnpm test`: 通过（52 个测试文件，488 个用例全部通过）。
- `pnpm build`: 通过（ESM, CJS, d.ts 打包成功）。
- `pnpm test:package`: 通过（tarball 安装与导入验证成功）。
