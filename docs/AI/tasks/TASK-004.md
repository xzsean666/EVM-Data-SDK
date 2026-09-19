# TASK-004: 全面架构优化与治理

## 1. 任务背景与目标
针对审计发现的核心问题进行全面架构优化与治理：
1. **执行层退避状态联动**：`ApiChainService` 接入 `CredentialPool`，候选轮询时跳过冷却中凭证，调用失败时记录退避状态，杜绝双轨制状态失步。
2. **Uniswap V4 模块治理**：实现纯 TypeScript/Buffer/BigInt 标准 Keccak-256 算法，消除 `poolIdFromKey` 抛错死代码；`getTokenPricesAtBlock` 默认使用已验证流动性池，避免合成错误噪音。
3. **告警子系统解耦**：抽象通用 `AlertReporter` 接口，解耦核心告警调度与具体上报实现，使 `SlackWebhookReporter` 实现该接口，支持无缝扩展自定义渠道。
4. **范围与约束明确**：项目所有者明确指示保留 CEX 归档爬虫与二进制 Kline 缓存层（`src/price/archive/`、`TokenSupportService.ts`、`UnifiedKlineService.ts`），以满足快速获取 kline 数据的核心业务诉求。

## 2. 详细优化方案与改动文件列表

### 2.1 执行层退避联动 (`src/services/ApiChainService.ts`, `src/execution/CredentialPool.ts`, `src/client/EvmDataClient.ts`)
- `src/execution/CredentialPool.ts`: 增加 `getLeaseByValue`、`isKeyCoolingDown` 与 `reportByValue`，支持根据 raw key 字符串直接查询与汇报状态。
- `src/services/ApiChainService.ts`: `ApiChainServiceOptions` 增加 `credentialPools`，候选遍历时调用 `pool?.isKeyCoolingDown(apiKey)` 跳过处于退避冷却期的 key；`withCandidateContext` 内在发生 `RATE_LIMITED` / 429、`AUTHENTICATION_FAILED` / 401/403 或调用成功时，向对应的 `CredentialPool` 汇报结果。
- `src/client/EvmDataClient.ts`: 实例化 `ApiChainService` 时传入 `credentialPools: this.credentialPools`。

### 2.2 Uniswap V4 治理 (`src/defi/uniswap/v4/`)
- `src/defi/uniswap/v4/UniswapV4PoolKeyCodec.ts`: 实现纯原生、零外部依赖的标准 64 位 Keccak-256 算法。`poolIdFromKey` 正确计算 32 字节哈希，彻底移除 `throw new Error(...)`。
- `src/defi/uniswap/v4/UniswapV4HistoricalPriceService.ts`: `getTokenPricesAtBlock` 默认仅遍历已验证流动性池（`pool.poolDeploymentBlock !== undefined && pool.poolDeploymentBlock !== "0"`），避免占位符候选池产生虚假冷却与错误噪音。
- `tests/unit/uniswap-v4-symbol.test.ts`: 补充针对 `keccak256`、`encodePoolKey` 与 `poolIdFromKey` 的单元测试。

### 2.3 告警接口解耦 (`src/alert/`)
- `src/alert/AlertReporter.ts`: 抽象通用 `AlertReporter` 与 `AlertReportResult` 接口。
- `src/alert/SlackWebhookReporter.ts`: 实现 `AlertReporter` 接口，`SlackWebhookReportResult` 别名为 `AlertReportResult`，保证 100% 向后兼容。
- `src/alert/AlertService.ts`: `AlertServiceOptions` 与内部 `reporter` 属性类型更新为 `AlertReporter`，支持任意可插拔告警渠道。
- `src/client/EvmDataClient.ts`: `EvmDataClientOptions.alertReporter` 接受通用 `AlertReporter`。
- `src/index.ts`: 导出 `AlertReporter` 与 `AlertReportResult`。
- `tests/unit/alert-service.test.ts`: 新增可插拔自定义 `AlertReporter` 测试用例。

### 2.4 CEX 归档与 Kline 缓存系统保持稳定
- 严格遵循所有者指令，`src/price/archive/`、`TokenSupportService.ts`、`UnifiedKlineService.ts` 保持原设计与完整功能，确保快速毫秒级 Kline 二进制区间切片与下载。

## 3. 验收标准与测试结果 (Definition of Done)
1. **单元测试**: 43 个测试文件，394 个用例全部通过 (`vitest run`).
2. **类型检查**: `pnpm typecheck` 0 错误 (`tsc --noEmit`).
3. **代码检查**: `pnpm lint` 0 警告 (`eslint .`).
4. **构建打包**: `pnpm build` ESM 与 CJS 构建全部成功。
5. **打包冒烟测试**: `pnpm test:package` 打包验证测试成功。
6. **敏感信息脱敏**: 无任何 API Key 或敏感信息硬编码或暴露在日志中。
