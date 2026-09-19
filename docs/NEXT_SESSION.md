# Next Session Handoff (任务交接文档)

## 1. 当前基本信息
- **任务编号**: TASK-003 (已完成归档)
- **任务目标**: 引入 `/ssd0/git/evm-call` 作为 EVM RPC 交互基座，彻底清理项目内部所有冗余老代码、中间垫片、重复领域模型与重复单元测试，生成 Context 规范文档并固化 Git Commit Hash 升级 SOP。
- **当前状态**: `DONE` (Standby 待命)

## 2. 本次已交付功能与深度清理细节
1. **`evm-call` 依赖集成与 Hash 锁定**:
   - 依赖配置: `"evm-call": "github:xzsean666/evm-call#d7a5c16d2bcbda6255d05f1f5b745eac88f699c0"`。
   - `node_modules/evm-call/dist` 类型与 CJS/ESM bundle 完好，TypeScript 编译完美兼容。
2. **彻底物理删除 20 个冗余文件（累计精简 ~4,500 行老代码与单测）**:
   - **8 个 `src/rpc/` 胶水垫片**:
     `src/rpc/ArchiveRpcTransport.ts`、`src/rpc/Erc20MulticallCodec.ts`、`src/rpc/EthereumArchiveRpcExecutor.ts`、`src/rpc/EthereumMulticall3Codec.ts`、`src/rpc/JsonRpcBatchExecutor.ts`、`src/rpc/RandomSource.ts`、`src/rpc/builtinBaseArchiveRpcs.ts`、`src/rpc/builtinEthereumArchiveRpcs.ts`
   - **3 个 `src/domain/` 重复模型定义**:
     `src/domain/jsonRpcModels.ts`、`src/domain/erc20MulticallModels.ts`、`src/domain/rpcModels.ts`
   - **9 个 `tests/unit/` 重复底层单测**（逻辑已在 `evm-call` 独立仓库中拥有 100% 完整测试覆盖）:
     `tests/unit/archive-rpc-transport.test.ts`、`tests/unit/multicall3-codec.test.ts`、`tests/unit/erc20-multicall.test.ts`、`tests/unit/json-rpc-batch-executor.test.ts`、`tests/unit/ethereum-archive-rpc-executor.test.ts`、`tests/unit/random-source.test.ts`、`tests/unit/builtin-ethereum-archive-rpcs.test.ts`、`tests/unit/builtin-base-archive-rpcs.test.ts`、`tests/unit/ethereum-archive-rpc-pool.test.ts`
3. **保留模块瘦身与架构极简**:
   - `src/rpc/EthereumArchiveRpcPool.ts`: 从 313 行自实现缩减至 28 行，直接继承 `evm-call` 的 `RpcPool`，平滑兼容 `expectedChainId` 属性。
   - `src/rpc/RpcService.ts`: 直接消费 `evm-call` 的编解码器与模型。
   - `src/index.ts`: 顶层直接 re-export `evm-call` 的核心类型与方法，确保对外公共 API 契约向下兼容无缝平替。
   - 业务模块（`TokenService`, `ChainlinkService`, `DeFiExchangeRateService`, `UniswapV3HistoricalPriceService`, `UniswapV4HistoricalPriceService`, `AlchemyAdapter`, `AlertService`, `EvmDataClient`）统一直接使用 `evm-call`。
4. **Context 规范文档沉淀 (`docs/EVM_CALL_CONTEXT.md`)**:
   - 记录上游元数据、仓库坐标与当前 Git Commit Hash (`d7a5c16d2bcbda6255d05f1f5b745eac88f699c0`)。
   - 详尽拆解 `evm-call` 七大核心特性（节点池阶梯退避、SQLite 两级缓存、JSON-RPC Batch 自动切片、Multicall3 重组断言、原生 ERC-20 极速解码、日志自适应切片与流式迭代、内插时间戳查块）。
   - 固化升级 `evm-call` 并更新 Hash 的 6 步标准操作规程 (SOP)。
5. **文档同步**:
   - `docs/INTEGRATIONS.md`: Section 21: `evm-call`。
   - `docs/AI/DECISIONS.md`: ADR-038。
   - `docs/AI/SESSION_STATE.md`: 同步更新。

## 3. 验证结果
- 静态检查: `pnpm typecheck`（0 错误），`pnpm lint`（0 警告）。
- 自动化测试: 43 个测试套件，392 个测试用例全部通过。
- 构建打包: `pnpm build`（ESM, CJS, d.ts 打包成功）。
- 打包验证: `pnpm test:package`（tarball 安装与 consumer ESM/CJS/TS 导入验证成功）。

## 4. 下一步任务建议 (Next Actions)
- 当前待命。项目结构已完成极致瘦身，彻底消除与底层 RPC 库的重复实现。未来升级 `evm-call` 遵循 SOP 更新 hash 即可。
