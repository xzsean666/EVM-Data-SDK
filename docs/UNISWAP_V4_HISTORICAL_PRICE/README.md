# Uniswap V4 Historical Price

本目录是 Uniswap V4 历史价格功能的实施交接包。目标是新增与现有
`client.uniswapV3` 相同使用习惯的 `client.uniswapV4`，同时把 V3/V4 的
共用能力收敛到清晰、可测试的共享边界。

| 文档 | 用途 |
| --- | --- |
| [`UPGRADE.md`](./UPGRADE.md) | 产品契约、V3/V4 目录规范、V4 数据模型、架构、错误和验收标准。 |
| [`TASK_BREAKDOWN.md`](./TASK_BREAKDOWN.md) | 按依赖顺序执行的任务包、文件清单、测试门禁和交接要求。 |
| [`AI_IMPLEMENTATION_PROMPT.md`](./AI_IMPLEMENTATION_PROMPT.md) | 可直接交给 Claude Sonnet 5 或 ChatGPT Terra 的实现 prompt。 |

当前状态：仅为文档和实施设计，未在本次变更中修改源码、依赖或运行时行为。

关键原则：V4 是 Singleton `PoolManager` 模型，不存在 V3 意义上的每池
`slot0()` 合约；历史状态必须通过经过验证的 V4 状态读取入口（首选
`StateView`，或经架构批准的 `extsload` 方案）在精确 block tag 下读取。
V3 的地址清单、Factory、fee-tier 和 slot0 codec 不能直接冒充 V4 事实。
