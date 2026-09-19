# Next Session Handoff (任务交接文档)

## 1. 当前基本信息
- **任务编号**: TASK-003 (已完成归档)
- **任务目标**: 引入 `/ssd0/git/evm-call` 作为 EVM RPC 交互基座，清理项目内部所有冗余老代码，生成高可用架构与 Context 规范文档，固化 Git Commit Hash 升级 SOP。
- **当前状态**: `DONE` (Standby 待命)

## 2. 本次已交付功能与架构细节
1. **`evm-call` 依赖集成与 Hash 锁定**:
   - 依赖配置: `"evm-call": "github:xzsean666/evm-call#d7a5c16d2bcbda6255d05f1f5b745eac88f699c0"`。
   - `node_modules/evm-call/dist` 类型与 CJS/ESM bundle 完好，TypeScript 编译完美兼容。
2. **彻底清理冗余老代码，全量底层委托**:
   - `src/rpc/ArchiveRpcTransport.ts`: 移除自实现的 ~300 行 JSON-RPC Transport 代码，直接重导出 `evm-call` 实现。
   - `src/rpc/Erc20MulticallCodec.ts`: 移除 ~60 行 ERC-20 编解码代码，直接委托 `evm-call` 的 `Erc20Codec`。
   - `src/rpc/EthereumMulticall3Codec.ts`: 移除 ~200 行 Multicall3 编解码代码，直接委托 `evm-call` 的 `Multicall3Codec`。
   - `src/rpc/EthereumArchiveRpcExecutor.ts`: 移除 ~500 行执行器实现，直接委托 `evm-call` 的 `EthereumArchiveRpcExecutor`。
   - `src/rpc/JsonRpcBatchExecutor.ts`: 移除 ~280 行 Batch 调度代码，直接委托 `evm-call` 的 `JsonRpcBatchExecutor`。
   - `src/rpc/RandomSource.ts`: 移除 ~25 行 Fisher-Yates shuffle，直接委托 `evm-call`。
   - `src/rpc/builtinEthereumArchiveRpcs.ts` 与 `builtinBaseArchiveRpcs.ts`: 委托至 `evm-call` 内置节点池候选列表。
   - 净清理移除 **1,380+ 行** 重复代码，SDK 代码体积极致精简。
3. **Context 规范文档沉淀 (`docs/EVM_CALL_CONTEXT.md`)**:
   - 记录上游元数据、仓库坐标与当前 Git Commit Hash (`d7a5c16d2bcbda6255d05f1f5b745eac88f699c0`)。
   - 详尽拆解 `evm-call` 七大核心特性（节点池阶梯退避、SQLite 两级缓存、JSON-RPC Batch 自动切片、Multicall3 重组断言、原生 ERC-20 极速解码、日志自适应切片与流式迭代、内插时间戳查块）。
   - 梳理完整的 API 清单、模型定义、错误体系与委托映射关系。
   - 固化升级 `evm-call` 并更新 Hash 的 6 步标准操作规程 (SOP)。
4. **架构与外部依赖文档同步**:
   - `docs/INTEGRATIONS.md`: 补充 Section 21: `evm-call`。
   - `docs/AI/DECISIONS.md`: 记录 ADR-038。
   - `docs/AI/TASK_INDEX.md` & `docs/AI/tasks/TASK-003.md`: 登记并归档 TASK-003。

## 3. 验证结果
- 静态检查: `pnpm typecheck`（0 错误），`pnpm lint`（0 警告）。
- 自动化测试: 52 个测试套件，488 个测试用例全部通过。
- 构建打包: `pnpm build`（ESM, CJS, d.ts 打包成功）。
- 打包验证: `pnpm test:package`（tarball 安装与 consumer ESM/CJS 导入验证成功）。

## 4. 下一步任务建议 (Next Actions)
- 当前待命。代码库处于高度整洁健康状态，未来升级 `evm-call` 遵循 SOP 更新 hash 即可。
