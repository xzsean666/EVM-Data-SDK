# TASK-005: 存储层双引擎加固与 PostgreSQL 生产级优化

## 1. 任务背景与目标
用户确认保留 `SyncService`（增量同步）与 `HistoryService`（账本重放）引擎，并要求完善其可用性，强化双存储驱动架构：
- **默认驱动**：Node 24 原生 SQLite (`node:sqlite` DatabaseSync)，本地零依赖直接运行。
- **扩展驱动**：PostgreSQL (`pg` Pool)，支持通过配置或 `DATABASE_URL` 传入并生产级稳定运行。

针对 PostgreSQL 驱动与转译器的关键优化项：
1. **补齐冲突目标映射**：在 `POSTGRES_CONFLICT_TARGETS` 中补充遗漏的 `sdk_token_support: ["token", "provider"]`，确保 `TokenSupportStore.set()` 在 Postgres 下正常执行 Upsert。
2. **对齐版本迁移**：在 `PostgresStorageAdapter.initialize()` 中对齐迁移版本 6（记录 `sdk_token_support` 迁移），保持 SQLite 与 Postgres 迁移版本一致。
3. **连接池空闲容错**：在 `pg.Pool` 上监听 `'error'` 事件，防止空闲连接由于网络闪断或服务端重启抛出未捕获异常导致 Node 进程崩溃。
4. **线性参数转译**：将 `normalizePostgresSql` 中 $O(N^2)$ 的占位符正则切片替换为单遍线性计数器 `$1, $2, ...`，提高高并发 SQL 转换吞吐量。
5. **敏感凭据脱敏**：在 Postgres 连接失败与迁移报错路径中引入 `redactUrl` 与 `redactMessage`，杜绝密码在日志和异常堆栈中泄露。

## 2. 改动文件列表与影响范围
- `src/storage/StorageAdapter.ts`:
  - `POSTGRES_CONFLICT_TARGETS` 添加 `sdk_token_support`
  - `PostgresStorageAdapter.initialize()` 补全迁移版本 6、增加 pool 错误捕获、连接异常脱敏
  - `normalizePostgresSql()` 优化为线性参数绑定
- `tests/unit/postgres-storage-contract.test.ts`:
  - 增加对 `sdk_token_support`、`sdk_cooldown_states`、参数线性绑定及异常脱敏的完整测试覆盖
- `docs/AI/DECISIONS.md`:
  - 新增 ADR-040: Dual Storage Driver Architecture: Hardened PostgreSQL & Native SQLite Default

## 3. 验收标准与测试结果 (Definition of Done)
1. **单元测试**: 43 个测试文件，397 个用例全部通过 (`vitest run`).
2. **类型检查**: `pnpm typecheck` 0 错误 (`tsc --noEmit`).
3. **代码检查**: `pnpm lint` 0 警告 (`eslint .`).
4. **构建打包**: `pnpm build` ESM 与 CJS 构建全部成功。
5. **打包冒烟测试**: `pnpm test:package` 打包验证测试成功。
6. **敏感信息脱敏**: PostgreSQL 报错堆栈及日志中的密码全部被 `[REDACTED]` 保护。
