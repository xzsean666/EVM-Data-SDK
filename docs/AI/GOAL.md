# EVM Data SDK - Project Goal (总目标)

## 1. 项目定位与使命

`EVM Data SDK` 是一个面向生产环境的高可靠、Node.js 优先的 TypeScript 基础库，旨在为 Web3 后端应用提供标准、强类型、零精度损失的链上与市场数据查询服务。

核心解决痛点：
- **数据源异构与碎片化**：不同浏览器及 RPC 提供商（Etherscan, Blockscout, Alchemy, Moralis）接口语义差异大、速率限制各异、分页模型不互通。
- **精度安全**：JavaScript IEEE 754 浮点数无法安全表示 256 位大整数，所有链上整数金额与区块号统一采用规范十进制字符串 (`decimal string`)。
- **历史归档与多链准确度**：通过 direct-only Archive RPC 结合 Multicall3 提供确定性区块的高效回溯，杜绝非归档节点的静默回滚或假数据。
- **高可用与风控防御**：统一调度多凭证轮换、阶梯式退避冷却（Stepped Cooldown Backoff）、Slack 告警与跨进程 SQLite 本地状态持久化。

---

## 2. 核心架构与设计原则

1. **能力感知路由 (Capability-Aware Routing)**
   - 以 EIP-155 标准 Chain ID 作为唯一的网络身份基准。
   - 仅当 Provider 明确声明支持目标链、操作类型及过滤条件时才参与路由。
   - 绝不抹平语义不一致的 Provider 行为（如不将转账日志伪装为普通交易）。

2. **中心化受限执行层 (Central Bounded Execution)**
   - 统一由 `RequestExecutor` 和 `PriceRequestExecutor` 负责超时预算、重试、凭证租赁、代理切换与故障转移。
   - 单个 Adapter 仅执行单次尝试，不设内部隐式重试。
   - 分页游标与原始 Provider 强绑定（Pinned continuation cursor），避免跨 Provider 翻页导致数据重复或遗漏。

3. **零敏感信息泄露 (Secret-Safe Boundary)**
   - API Key、代理密码、认证 URL、内部游标等敏感数据在异常、日志、快照及错误回显中必须完全脱敏或抹除。

4. **无隐式全局状态与外部依赖隔离**
   - 不使用任何全局单例或隐式读取 `process.env`，配置必须显式传入构造函数。
   - 不依赖重量级第三方 Web3 巨石库（如 Web3.js / Ethers 全量包），采用纯轻量 ABI 编解码与 Axios/Zod 精确校验。

---

## 3. 当前功能里程碑状态 (Current Milestone State)

- [x] **v0.1 基础索引数据层**：Etherscan V2、Moralis、Alchemy 基础代币余额与交易/转账查询。
- [x] **v0.2 代币价格聚合器**：Binance, OKX, Coinbase, GeckoTerminal 日线 OHLCV 与最新价聚合。
- [x] **v0.3 统一 HTTP 代理与区块范围扫描**：自适应区块范围滑动窗口与轻量级全局 HTTP Proxy-Only 方案（彻底移除 sing-box/VLESS 运行时）。
- [x] **v0.4 预言机与多链 Multicall3**：Chainlink 历史报价回溯、精确区块 Multicall3 批量调用。
- [x] **v0.5 DeFi 兑换率快照**：以太坊及 Base 链主流 DeFi 协议（LST/Lending/LP/Vault）兑换率无缝聚合。
- [x] **v0.5+ 韧性与运维子系统**：多级阶梯式故障冷却、Slack Webhook 24小时聚合告警、SQLite 本地持久化。

---

## 4. 后续目标与演进方向 (Future Objectives)

1. **发布与开源准备 (Release Readiness)**：
   - 确定 npm 包名、Scope、开源许可证与 Changesets 发布流水线。
   - 补齐对外快速上手与 API 契约文档。
2. **多链 RPC 与协议扩展 (Multi-Chain Expansion)**：
   - 依据已验证的候选池与测试规范，扩展 Arbitrum, Optimism 等二层网络的 Multicall3 与 Chainlink/DeFi 支持。
3. **性能与流式接口演进**：
   - 在维持现有单 session / 单 task 规范的前提下，探索更大范围区块数据的异步迭代流式扫描（Async Iterator）。
