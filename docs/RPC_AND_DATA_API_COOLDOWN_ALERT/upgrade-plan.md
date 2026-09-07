# RPC 池与 Data-API 池优化及报警功能升级规划

## 1. 当前项目情况

当前 EVM-Data-SDK 项目中，数据请求与链上交互主要分为两大通路：

1. **RPC 池子 (`EthereumArchiveRpcPool`)**：
   - 维护一组归一化的以太坊/多链归档节点（内置公开节点如 `drpc-public`、`blastapi-public` 等，或由配置传入的自定义节点）。
   - 初始化时通过 `initialize()` 批量发送探活探测（`eth_chainId`、`eth_getBlockByNumber`、`eth_call`），并将探测结果以布尔值存入 `healthy: Map<string, boolean>`。
   - 调用时通过 `healthySnapshot()` 结合随机数生成器进行洗牌（Shuffle）随机选择健康节点。
   - 节点一旦在实际调用中报错，通过 `reportOutcome(id, "failure")` 直接将健康状态标记为 `false`，缺乏渐进式冷却与重试机制。
   - **关于 Alchemy**：目前系统中 Alchemy 主要作为 Data-API 提供商（在 `EnvLoader` 和 `EvmDataClient` 中解析为 Data-API provider），默认情况下并没有将 Alchemy 的 RPC 端点自动加入到公共 RPC 池中。

2. **Data-API 池子 (`CredentialPool`)**：
   - 负责管理外部索引服务（Etherscan、Alchemy、Blockscout、Moralis）的 API Key。
   - 凭证分配使用轮询/随机机制。
   - 当遇到限流报错（`rate_limited`）时，仅支持固定的短时冷却（默认 1 秒）；遇鉴权失败则直接永久禁用，缺乏针对网络/临时异常的递增冷却机制。

3. **报警监控现状**：
   - 当前项目仅支持本地的 `logger` 与 `telemetry` 回调，未集成任何远程 Webhook（如 Slack）告警机制。
   - 当某些 API Key 或公共 RPC 长期不可用时，系统无法主动向运维或开发者告警。

---

## 2. 本次升级要解决的问题

1. **调用报错缺乏渐进退避 CD 机制**：
   - 现有的 RPC 池与 Data-API 池在节点/Key 发生调用错误时，要么直接标记不可用，要么冷却时间过短。
   - 缺少“报错后进入 CD 冷却：初始 1 分钟 -> 5 分钟 -> 逐步叠加至最高 1 天”的阶梯退避逻辑。
   - 缺少“最长 1 天冷却期内仅尝试调用一次，成功后完全清空 CD”的健康恢复机制。

2. **Alchemy 默认未加入 RPC 池**：
   - Alchemy 拥有稳定且高性能的 Archive RPC 能力，但目前默认配置未将其自动整合到 RPC 候选池中与公共节点一起随机调度。

3. **长期故障缺乏自动化报警通知**：
   - 当公共 RPC、带 API Key 的 RPC 或 Data-API 凭证连续故障并达到最大 CD（1 天）时，缺乏对外告警通道。
   - 缺少周期性（每天汇总一次）将故障节点详情、对应环境变量名（Env Key Name）、累计 CD 持续时间发送到 Slack Webhook 的能力。

---

## 3. 升级目标

1. **统一的退避 CD 状态管理**：
   - 实现阶梯退避 CD 策略：初次报错 CD 为 1 分钟，再次报错叠加为 5 分钟，随后继续叠加直至封顶 1 天（24 小时）。
   - 在 CD 期间，该节点/Key 处于冷却状态，不参与随机选择。
   - 当 CD 到期后，允许发起一次尝试调用：
     - 若调用成功：立即清除该节点/Key 的所有 CD 状态与故障计数，恢复健康。
     - 若调用失败：继续按阶梯递增，或在已达上限时维持 1 天 CD。
2. **RPC 池全面接入 CD**：
   - `EthereumArchiveRpcPool` 引入 CD 管理，替换原有的简单布尔标记。
   - 公共 RPC 与带 API Key 的私有 RPC 端点均纳入 CD 生命周期追踪。
3. **Data-API 池全面接入 CD**：
   - `CredentialPool` 引入相同的阶梯 CD 机制，记录各 API Key 的冷却状态与累计故障时长。
4. **Alchemy RPC 加入 RPC 池**：
   - 在配置或环境变量加载时，支持将 Alchemy 凭证生成的 RPC 端点纳入 RPC 池，与公共节点一同享受调度与 CD 管理。
5. **基于 Webhook 的 1 天 CD 报警功能**：
   - 报警功能默认关闭，仅在配置了 Webhook（如 Slack Webhook URL）且显式开启时生效。
   - 触发条件：存在达到 1 天 CD 上限的公共 RPC、API Key RPC 或 Data-API Key。
   - 频次限制：每 1 天发送一次报告（24 小时汇总一次，防止告警刷屏）。
   - 报告内容：包含节点详细信息、所属网络/Provider、环境变量名（如 `ALCHEMY_API_KEY`，严禁泄露密钥原值）、累计处于 CD 的总时长。

---

## 4. 升级方案

升级分为四个核心设计要点：

### 4.1 阶梯退避策略（Backoff Cooldown Strategy）
- 抽象独立的退避阶梯计算逻辑：
  - CD 阶梯定义：第 1 次失败 1 分钟（60s），第 2 次失败 5 分钟（300s），后续依次叠加（例如：15m -> 30m -> 1h -> 2h -> 4h -> 8h -> 12h -> 24h，或指数/递增叠加，封顶 86,400s / 24 小时）。
  - 维护每个资源的运行状态：`failureCount`（连续失败次数）、`currentCooldownMs`（当前 CD 时长）、`cooldownUntil`（冷却截止时间戳）、`firstFailureAt`（首次进入故障的时间戳，用于计算累计 CD 总时长）。
  - 成功时调用 `reset()`：将连续失败次数归零，清除 `cooldownUntil` 和 `firstFailureAt`。

### 4.2 RPC 池与 Data-API 池适配
- **RPC 池 (`EthereumArchiveRpcPool`)**：
  - 在 `healthySnapshot()` 筛选时，判断当前时间是否小于 `cooldownUntil`，在冷却期内的端点被排除。
  - 冷却期结束后，端点重新具备被选中资格（尝试探测或实际调用）。
  - `reportOutcome(id, "success")` 时触发重置清除 CD；`reportOutcome(id, "failure")` 时触发阶梯叠加。
- **Data-API 池 (`CredentialPool`)**：
  - 在 `acquire()` 获取租借凭证时，跳过仍处于 CD 中的 Key。
  - 在 `report(lease, outcome)` 处理报错时，将原来的固定 1s 替换为阶梯退避 CD。
  - 记录每个 Key 对应的原始环境变量名称（如 `ETHERSCAN_API_KEY_1`），供告警使用。

### 4.3 Alchemy RPC 注入优化
- 在 `EnvLoader` 和 `EvmDataClient` 初始化时，规范 Alchemy RPC 端点的注册流程。
- 当环境变量或配置中包含 `ALCHEMY_API_KEY` 时，若未禁用，将其对应的 JSON-RPC URL 注册到 RPC 池的备选节点列表中。

### 4.4 Webhook 报警服务（Alert / Slack Webhook Reporter）
- **配置扩展**：在客户端配置中增加 `alert` 选项（如 `alert: { enabled: boolean; slackWebhookUrl?: string }`）。
- **告警服务 (`AlertService`)**：
  - 负责定期检查（或在调用后触发防抖检查）RPC 池与 Data-API 池的状态。
  - 筛选出满足条件的条目：`currentCooldownMs >= 24 * 60 * 60 * 1000`（达到 1 天 CD）。
  - 控制上报周期：记录 `lastReportedAt`，保证两次报告发送间隔不少于 24 小时（1 天）。
  - 安全与脱敏：严格遵循安全原则，报告内容中只包含脱敏标识、节点 ID、Provider 类型、对应环境变量 Key 名称、进入 CD 的总时长（如 "已处于 CD 状态 26 小时 15 分钟"），绝不泄露 API Key 明文或完整带 token 的 URL。

---

## 5. 主要涉及的模块

| 模块/文件 | 变更性质 | 核心职责 |
|---|---|---|
| `src/execution/CooldownTracker.ts` | 新增 | 独立的阶梯退避 CD 算法与状态维护，管理 1m -> 5m -> 24h 递增及重置 |
| `src/rpc/EthereumArchiveRpcPool.ts` | 修改 | RPC 池引入阶梯 CD，过滤处于 CD 期的端点，记录累计时长 |
| `src/execution/CredentialPool.ts` | 修改 | Data-API 凭证池引入阶梯 CD，支持记录 Env Key 名称及累计故障时长 |
| `src/env/EnvLoader.ts` | 修改 | 解析 Alert Webhook 配置，保留 Env Key 名称元数据，确保 Alchemy RPC 正确注入 |
| `src/domain/configuration.ts` | 修改 | 扩展 ClientConfiguration Schema，增加 `alert` 配置项及校验规则 |
| `src/alert/SlackWebhookReporter.ts` | 新增 | 负责格式化告警内容并推送到 Slack Webhook，控制 1 天 1 次的发送频次 |
| `src/client/EvmDataClient.ts` | 修改 | 组装 RPC 池、Data-API 池、Alchemy RPC 端点及 AlertService 的生命周期 |
| `tests/unit/...` | 新增/修改 | 针对 CD 阶梯、池子过滤、恢复清空、Slack 告警、环境变量元数据的单元测试 |

---

## 6. 最终需要达到的效果

1. **自动容错与自愈**：
   - 偶发报错的 RPC 节点或 API Key 会先冷却 1 分钟，如果问题迅速恢复，在下次尝试成功后立即重置 CD，不受持续影响。
   - 持续报错的节点冷却时间逐步扩大（5m、... 直至 1 天），避免频繁浪费配额或等待超时。
2. **最长 1 天探测保护**：
   - 严重损坏或被停用的节点最多每天被调度尝试一次，不影响正常的整体请求成功率。
3. **Alchemy 资源充分利用**：
   - 用户配置 Alchemy 后，其 RPC 端点能自动加入 RPC 负载池，提高可用性。
4. **运维透明与及时报警**：
   - 在配置了 Slack Webhook 时，如果任一 API Key 或 RPC 节点彻底瘫痪达到 1 天 CD，系统每天准时向 Slack 推送一份清晰的故障清单，明确标出哪个环境变量名出了问题、已持续多久，方便运维人员及时更换或充值。
