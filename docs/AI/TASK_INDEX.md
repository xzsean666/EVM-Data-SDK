# AI Tasks Index (任务索引)

> 当前状态：**待命 (Standby)**。TASK-001 已交付并归档。

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
| *(暂无活跃任务)* | - | - | - | - | - |

---

## 3. 历史已归档任务 (Archived Tasks)

| Task ID | 目标说明 | 完成时间 | 验证结果 |
| :--- | :--- | :--- | :--- |
| [TASK-001](tasks/TASK-001.md) | 彻底移除 sing-box 与 VLESS 依赖，统一全局 HTTP Proxy-Only 方案 | 2026-09-19 | 47 测试文件（463 用例）全绿，构建及打包验证成功 |
