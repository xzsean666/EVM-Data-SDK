# Next Session Handoff (任务交接文档)

## 1. 当前基本信息
- **任务编号**: TASK-002 (已完成归档)
- **任务目标**: 优化价格体系：Token 支持度检测、Kline 优先级聚合（Binance 优先，Gate 备选）与统一定长二进制历史归档缓存系统。
- **当前状态**: `DONE` (Standby 待命)

## 2. 本次已交付功能与架构细节
1. **Token 支持度检测与确定性 SQLite 缓存 (`TokenSupportService`)**:
   - `client.token.isTokenSupported(token, provider)` 与 `client.token.getTokenSupport(token)`。
   - 三级探测与防护：内存缓存 -> SQLite 持久化表 `sdk_token_support` -> 上游实时探活（严格 1s 超时）。
   - 确定性响应（Binance `TRADING` / Invalid symbol，Gate `tradable` / 404）写入 SQLite；超时/网络波动/5xx 绝不写库。
   - `client.token.preloadSupportedTokens()` 支持一键将 Binance（~2500）与 Gate（~3000）现货交易对加载至内存。
2. **统一定长二进制历史归档缓存 (`KlineBinaryCodec` / `KlineArchiveManager`)**:
   - 拒绝大体积 JSON 方案，采用 ADR-037 规范的 16 字节紧凑定长二进制 (`.bin`) 存储（UInt64LE 毫秒时间戳 + DoubleLE 价格）。
   - 单月 5m K 线仅 ~138 KB（小于 Binance 原始 zip），二分查找截取耗时 $<1\text{ms}$，零解压、零小对象 GC。
   - 纯 Node.js 内置 `zlib` 解压 Binance `.zip` 与 Gate `.csv.gz`，无需额外 npm 依赖。
   - 单并发下载锁（`AsyncLock`），避免同时下载多个归档包压垮带宽。
   - 1 天磁盘缓存 TTL，访问时自动清理过期文件。
3. **统一 Kline 聚合与价格查询 (`UnifiedKlineService`)**:
   - 暴露 `client.token.getKlines(request)` 与 `client.token.getKlinesPrices(request)`。
   - 严格优先级：Binance 优先，Gate 备选；两者皆不支持抛出 `TOKEN_NOT_FOUND`。
   - 智能时间分流：早于当前自然月月初的数据拉取归档包并二进制缓存，当月数据走 REST API，无缝拼接去重并截取 `[startMs, endMs)`。

## 3. 验证结果
- 全套静态检查：`pnpm typecheck`（0 错误），`pnpm lint`（0 警告）。
- 自动化测试：52 个测试文件，488 个测试用例全部通过（涵盖编解码、Token 探活、归档解压与切分、服务编排）。
- 构建与打包：`pnpm build`（ESM, CJS, d.ts 打包成功），`pnpm test:package`（tarball 导入与运行成功）。

## 4. 待办与后续建议
- 当前处于待命状态，等待开发者下发下一步需求（例如更多交易所归档支持、WebSocket 实时流或更多 API 链扩展）。

