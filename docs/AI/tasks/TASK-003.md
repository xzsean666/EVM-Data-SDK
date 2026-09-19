# TASK-003: 建立 evm-call RPC 基座依赖、Context 文档与升级 SOP

## 1. 任务基本信息

- **Task ID**: TASK-003
- **状态**: `DONE`
- **关联模块**: `src/rpc/`, `docs/EVM_CALL_CONTEXT.md`, `package.json`, `pnpm-lock.yaml`, `docs/INTEGRATIONS.md`, `docs/AI/DECISIONS.md`
- **架构决策**: ADR-038
- **创建时间**: 2026-09-19
- **完成时间**: 2026-09-19

---

## 2. 目标与验收标准 (Acceptance Criteria)

1. **引入 `evm-call` Git 依赖并锁定 Commit Hash**：
   - 使用 `pnpm add github:xzsean666/evm-call#d7a5c16d2bcbda6255d05f1f5b745eac88f699c0` 成功加入 `dependencies`。
   - `node_modules/evm-call/dist` 类型文件与 bundle 能被项目 TypeScript 正常加载与解析。
2. **清理 `src/rpc/` 内部冗余老代码，全面委托至 `evm-call`**：
   - `ArchiveRpcTransport.ts`: 移除 ~300 行自实现传输层，直接委托 `evm-call`。
   - `Erc20MulticallCodec.ts`: 移除 ~60 行 ERC-20 编解码，直接委托 `evm-call`。
   - `EthereumMulticall3Codec.ts`: 移除 ~200 行 Multicall3 ABI 编解码，直接委托 `evm-call`。
   - `EthereumArchiveRpcExecutor.ts`: 移除 ~500 行批执行器，直接委托 `evm-call`。
   - `JsonRpcBatchExecutor.ts`: 移除 ~280 行 Batch 调度器，直接委托 `evm-call`。
   - `RandomSource.ts`: 移除 ~25 行 Fisher-Yates shuffle，直接委托 `evm-call`。
   - `builtinEthereumArchiveRpcs.ts` & `builtinBaseArchiveRpcs.ts`: 委托至 `evm-call` 内置节点池。
   - 净清理移除 1,380+ 行冗余重复代码。
3. **构建高可用 Context 架构与升级指南文档 (`docs/EVM_CALL_CONTEXT.md`)**：
   - 明确标注上游仓库地址、本地路径、当前锁定 Hash 与依赖格式。
   - 深入阐述 `evm-call` 的核心机制：RPC 节点池、阶梯式退避冷却 (`1m`~`24h`)、SQLite L1/L2 缓存、JSON-RPC Batch 自动切片、Multicall3 确定性聚合、事件日志流式切片与时间戳内插二分查块。
   - 梳理完整的 API 清单、数据模型、错误码体系。
   - 制定详细的未来升级与更新 Hash 的标准操作规程 (SOP)。
4. **架构与外部集成文档同步**：
   - 在 `docs/INTEGRATIONS.md` 中记录 `evm-call` 外部依赖规格、版本与使用约定。
   - 在 `docs/AI/DECISIONS.md` 中增加 ADR-038 架构决策记录。
5. **验证现有工程全绿**：
   - `pnpm typecheck` 0 错误。
   - `pnpm lint` 0 警告。
   - `pnpm test` 全量 52 个测试套件、488 个用例全部通过。
   - `pnpm build` 与 `pnpm test:package` 打包验证 100% 成功。

---

## 3. 验证结果

- `pnpm typecheck`: 通过（0 错误）。
- `pnpm lint`: 通过（0 警告，0 错误）。
- `pnpm test`: 通过（52 个测试文件，488 个用例全部通过）。
- `pnpm build`: 通过（ESM, CJS, d.ts 打包成功）。
- `pnpm test:package`: 通过（tarball 安装与 consumer 导入测试成功）。

