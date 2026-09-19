# TASK-001: 彻底移除 sing-box 与 VLESS 依赖，统一全局 HTTP Proxy-Only 方案

## 1. 目标 (Objective)

彻底清理 SDK 内部对 `sing-box` 运行时、二进制下载管理、本地配置文件生成以及非标准代理协议（`vless://`, `vmess://`, `ss://` 等）的所有代码与测试；将 SDK 代理架构全面统一收敛至基于标准 `http_proxy` 的轻量级 `ProxyPool` 方案，并确立全局统一的 `proxy-only` 契约（当启用代理时，所有外网数据与价格请求严格经由 HTTP 代理池调度，禁止静默回退 direct 直连，无可用代理时快速失败并脱敏返回）。

---

## 2. 范围 (Scope)

### 2.1 彻底清理 sing-box 与 VLESS
1. **删除废弃模块**：
   - 删除 `src/proxy/SingBoxBinaryManager.ts`
   - 删除 `src/proxy/SingBoxConfigBuilder.ts`
   - 删除 `src/proxy/SingBoxProxyManager.ts`
   - 删除 `src/proxy/SingBoxRuntime.ts`
   - 删除 `src/proxy/SingBoxUrlParser.ts`
   - 删除 `examples/sing-box-prewarm/` 整个示例工程
   - 删除测试用例 `tests/unit/sing-box.test.ts`
2. **清理核心领域配置与错误定义**：
   - 在 `src/domain/configuration.ts` 中移除：
     - `SingBoxRuntimeConfiguration`
     - `SingBoxProxyConfiguration`
     - `NormalizedSingBoxRuntimeConfiguration`
     - `NormalizedSingBoxProxyConfiguration`
     - `ClientConfiguration.advancedProxy` 与 `NormalizedClientConfiguration.advancedProxy`
     - `advancedProxySchema` 与 `normalizeAdvancedProxy` 函数
   - 在 `src/domain/errors.ts` 中移除 8 个 `SING_BOX_*` 错误码。
3. **清理环境加载器**：
   - 在 `src/env/EnvLoader.ts` 中移除：
     - `getSingBoxUrls()`
     - `findLocalSingBoxBinary()`
     - `toClientConfiguration` 中的 `advancedProxy` 组装
     - 简化 `getProxies()`，仅严格匹配 `http:` / `https:` 标准代理格式，移除对 VLESS/SS 的特殊过滤或分支。

### 2.2 统一全局 HTTP Proxy-Only 方案
1. **单点代理池共享 (Unified Shared ProxyPool)**：
   - `EvmDataClient` 统一初始化单例 `ProxyPool`。
   - `RequestExecutor`、`ApiChainService` 以及 `PriceRequestExecutor` 共享同一个 `ProxyPool` 实例，保证代理租约、轮换与 `cooldownMs` 退避状态全局同步，消除原先各自为政的多实例分化。
2. **统一全局 Proxy-Only 路由策略**：
   - 彻底移除 `RequestExecutor`、`PriceRequestExecutor`、`ApiChainService` 中的 `advancedProxyRoute`、`acquireManagedProxy()`、`nextAdvancedProxy()` 分支。
   - 当配置了 proxies 时或在全局 proxy-only 模式下：
     - `allowDirect: false`，杜绝任何静默 direct fallback。
     - 若代理池耗尽或均在冷却中，抛出标准脱敏 `PROXY_ERROR` / `UNAVAILABLE`，不再向外部泄露直连 IP。
   - 统一配置接口，消除 `requestPolicy.allowDirect` 与 `price.routeMode` 的语义割裂。

### 2.3 测试重构与回归
1. 重构 `tests/unit/client.test.ts` 中针对 `advancedProxy` / `sing-box` 的用例，替换为标准 HTTP 代理池的注入与行为断言。
2. 保留并补充 `tests/unit/pools.test.ts`、`tests/unit/request-executor.test.ts` 关于纯 HTTP 代理轮换、故障冷却、proxy-only 限制的单元测试。
3. 确保 `pnpm check`（包含 `typecheck`, `lint`, `test`, `build`, `test:package`）全绿。

---

## 3. 允许修改的文件 (Allowed Files)

### 待删除文件：
- `src/proxy/SingBoxBinaryManager.ts`
- `src/proxy/SingBoxConfigBuilder.ts`
- `src/proxy/SingBoxProxyManager.ts`
- `src/proxy/SingBoxRuntime.ts`
- `src/proxy/SingBoxUrlParser.ts`
- `tests/unit/sing-box.test.ts`
- `examples/sing-box-prewarm/**`

### 待修改文件：
- `src/domain/configuration.ts`
- `src/domain/errors.ts`
- `src/env/EnvLoader.ts`
- `src/client/EvmDataClient.ts`
- `src/execution/RequestExecutor.ts`
- `src/execution/ProxyPool.ts`
- `src/price/PriceRequestExecutor.ts`
- `src/services/ApiChainService.ts`
- `src/rpc/ArchiveRpcTransport.ts` (清理注释中的 sing-box 引用)
- `tests/unit/client.test.ts`
- `docs/AI/TASK_INDEX.md`
- `docs/AI/SESSION_STATE.md`
- `docs/AI/ARCHITECTURE.md`
- `docs/AI/DECISIONS.md`
- `docs/AI/GOAL.md`

---

## 4. 依赖关系 (Dependencies)

- **前置依赖**：无阻塞。v0.1 ~ v0.5+ 基线功能均已稳定交付并通过全量验证。
- **关联 ADR**：
  - 废弃/标记撤销 `ADR-023: Advanced proxy uses a managed sing-box loopback runtime`。
  - 新增 `ADR-036: Unified HTTP Proxy-Only Transport Architecture`。

---

## 5. 输入与输出 (Inputs and Outputs)

### 输入：
- 用户环境变量：`HTTP_PROXY`, `HTTPS_PROXY`, `PROXY_URL`（仅限标准 `http://` 与 `https://`）。
- 客户端配置：`ClientConfiguration.proxies`（标准 HTTP 代理列表）。

### 输出：
- 所有经过 SDK 发起的上游 Indexed Provider 与 Price HTTP 请求，统一走共享 `ProxyPool` 的 HTTP CONNECT / HTTP Forwarding 代理通道。
- 零本地子进程开销，零二进制下载与缓存开销，零临时配置文件与密钥落地风险。

---

## 6. 验收标准 (Acceptance Criteria)

1. **依赖与文件彻底清除**：
   - 仓库内 `src/` 和 `tests/` 中不再存在任何 `sing-box`、`vless`、`vmess` 相关的逻辑、类型或变量。
   - `examples/sing-box-prewarm/` 已完整移除。
2. **纯净标准 HTTP Proxy**：
   - 仅允许并解析 `http://` 和 `https://` 代理 URL。
   - `AxiosHttpTransport` 仅使用 `parseHttpProxyUrl` 和内置 Tunneling Agent 处理 HTTP/HTTPS 代理。
3. **全局统一 Proxy-Only**：
   - `EvmDataClient` 内各服务模块（`RequestExecutor`, `ApiChainService`, `PriceRequestExecutor`）统一接入单例 `ProxyPool`。
   - 在 proxy 模式下，`allowDirect: false`，无代理可用时严禁回退直连。
4. **编译与质量保障**：
   - `pnpm typecheck`：通过（0 错误）。
   - `pnpm lint`：通过（0 警告，0 错误）。
   - `pnpm test`：全部通过。
   - `pnpm build`：成功构建 ESM / CJS / d.ts 产物。
   - `pnpm test:package`：打包验证成功。

---

## 7. 验证命令 (Verification Commands)

```bash
# 1. 静态代码搜索确认无遗留
grep -rnI "sing-box" src/ tests/
grep -rnI "vless" src/ tests/

# 2. 自动化质量流水线
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:package
```

---

## 8. 风险与假设 (Risks and Assumptions)

- **假设**：调用方现已具备标准 HTTP/HTTPS 代理服务，不再需要 SDK 充当代理客户端拉起 sing-box 进程。
- **风险**：旧配置中若传入 `advancedProxy` 字段，需在类型与配置校验阶段明确报错（或优雅提示已废弃）。
- **Archive RPC 边界**：依据 ADR-028，Chainlink / DeFi 使用的 Ethereum/Base Archive RPC 仍保持独立的 direct-only 通道（直连 RPC 节点，不泄露 API Token 至公共代理），不受 HTTP 业务代理影响。

---

## 9. 状态 (Status)

`DONE`（已全部交付并通过验证）
