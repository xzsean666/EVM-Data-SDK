# AI Tasks Index (任务索引)

> 当前状态：**待命 (Standby)**。TASK-003 已交付并归档。

---

## 1. 任务流转规范

依据 [docs/AI_AGENT_PROMPT.md](file:///ssd0/git/EVM-Data-SDK/docs/AI_AGENT_PROMPT.md)，任务状态流转必须遵循：
```text
TODO -> IN_PROGRESS -> REVIEW -> DONE
                    \-> BLOCKED
```

- **TODO**：尚未开始。
- **IN_PROGRESS**：当前会话正在执行（单个 Session 最多处理一个 Task）。
- **REVIEW**：代码已完成，正在等待验证或人工检查。
- **DONE**：验收标准全部满足，全套测试验证通过，状态与文档已更新。
- **BLOCKED**：缺少必要外部信息或依赖阻塞。

---

## 2. 活跃与待办任务列表 (Task Backlog)

| Task ID | 目标说明 | 关联模块 | 状态 | 依赖 | 创建时间 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| - | 暂无进行中任务 | - | - | - | - |


---

## 3. 历史已归档任务 (Archived Tasks)

| Task ID | 目标说明 | 完成时间 | 验证结果 |
| :--- | :--- | :--- | :--- |
| [TASK-005](tasks/TASK-005.md) | 存储层双引擎加固与 PostgreSQL 生产级优化（冲突映射、线性转译、安全脱敏） | 2026-09-19 | 43 测试文件（397 用例）全绿，构建及打包验证成功 |
| [TASK-004](tasks/TASK-004.md) | 全面架构优化与治理（退避状态联动、Uniswap V4 原生 Keccak-256、告警接口解耦） | 2026-09-19 | 43 测试文件（394 用例）全绿，构建及打包验证成功 |
| [TASK-003](tasks/TASK-003.md) | 引入 evm-call 基座依赖、生成 Context 规范文档与升级 SOP | 2026-09-19 | 依赖锁定 d7a5c16，52 测试套件（488 用例）全绿，类型检查与 Lint 0 错误 |
| [TASK-002](tasks/TASK-002.md) | Token 支持度检测、Kline 优先级聚合与统一归档缓存系统 | 2026-09-19 | 52 测试文件（488 用例）全绿，构建及打包验证成功 |
| [TASK-001](tasks/TASK-001.md) | 彻底移除 sing-box 与 VLESS 依赖，统一全局 HTTP Proxy-Only 方案 | 2026-09-19 | 47 测试文件（463 用例）全绿，构建及打包验证成功 |
