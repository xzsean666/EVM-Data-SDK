# TASK-003: 建立 evm-call RPC 基座依赖、Context 文档与升级 SOP

## 1. 任务基本信息

- **Task ID**: TASK-003
- **状态**: `DONE`
- **关联模块**: `docs/EVM_CALL_CONTEXT.md`, `package.json`, `pnpm-lock.yaml`, `docs/INTEGRATIONS.md`, `docs/AI/DECISIONS.md`
- **架构决策**: ADR-038
- **创建时间**: 2026-09-19
- **完成时间**: 2026-09-19

---

## 2. 目标与验收标准 (Acceptance Criteria)

1. **引入 `evm-call` Git 依赖并锁定 Commit Hash**：
   - 使用 `pnpm add github:xzsean666/evm-call#d7a5c16d2bcbda6255d05f1f5b745eac88f699c0` 成功加入 `dependencies`。
   - `node_modules/evm-call/dist` 类型文件与 bundle 能被项目 TypeScript 正常加载与解析。
2. **构建高可用 Context 架构与升级指南文档 (`docs/EVM_CALL_CONTEXT.md`)**：
   - 明确标注上游仓库地址、本地路径、当前锁定 Hash 与依赖格式。
   - 深入阐述 `evm-call` 的核心机制：RPC 节点池、阶梯式退避冷却 (`1m`~`24h`)、SQLite L1/L2 缓存、JSON-RPC Batch 自动切片、Multicall3 确定性聚合、事件日志流式切片与时间戳内插二分查块。
   - 梳理完整的 API 清单、数据模型、错误码体系。
   - 规划 `EVM-Data-SDK` 内部现有 RPC 模块向 `evm-call` 平滑委托的映射路径。
   - 制定详细的未来升级与更新 Hash 的标准操作规程 (SOP)。
3. **架构与外部集成文档同步**：
   - 在 `docs/INTEGRATIONS.md` 中记录 `evm-call` 外部依赖规格、版本与使用约定。
   - 在 `docs/AI/DECISIONS.md` 中增加 ADR-038 架构决策记录。
4. **验证现有工程全绿**：
   - `pnpm typecheck` 0 错误。
   - `pnpm lint` 0 警告。
   - `pnpm test` 全量 52 个测试套件、488 个用例全部通过。

---

## 3. 验证结果

- `pnpm typecheck`: 通过（0 错误）。
- `pnpm lint`: 通过（0 警告，0 错误）。
- `pnpm test`: 通过（52 个测试文件，488 个用例全部通过）。
- `pnpm build`: 通过（ESM, CJS, d.ts 打包成功）。
