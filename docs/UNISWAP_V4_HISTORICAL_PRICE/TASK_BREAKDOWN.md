# Uniswap V4 Historical Price 任务拆分

状态：未实施，本次仅提交文档。
执行顺序：前一任务包失败时，不开始后一任务包；任何 scope 扩展都必须先
更新 `UPGRADE.md` 并得到 owner approval。

## Package 0 — Context discovery 与变更闸门

完整阅读 `Agent.md`、根级 canonical docs、现有
`docs/UNISWAP_V3_HISTORICAL_PRICE/*` 和本目录三份核心文档。检查：

- `EvmDataClient`、configuration normalization、public exports；
- `RpcService`、Archive pool/executor/transport、Multicall3 codec；
- `UniswapV3HistoricalPriceService`、V3 models/registry/slot0/math 及测试；
- DeFi/Chainlink 的 Archive pool composition 和 failure conventions；
- package scripts、typecheck/lint/test/build/package smoke。

先只输出 Step 0 / Step 1 报告，不改 `src/`、不安装依赖。报告必须列出
准确的拟修改文件、共享边界、数据流、风险、测试 seam 和未证实的 V4
事实。若 owner 已在任务上下文中明确授权实施，也仍要保留该报告，并在
开始 Package 1 前列出授权假设。

## Package 1 — 外部事实、ABI 和部署证据

在 `docs/INTEGRATIONS.md` 和本目录 handoff 中记录来源与证据，至少覆盖：

1. Ethereum V4 `PoolManager` address/deployment lower bound；
2. `StateView` address/deployment lower bound 和 exact read ABI；
3. PoolKey field order、currency ordering、PoolId hashing；
4. state getter 返回 tuple、selector、signed tick、fee semantics；
5. native ETH sentinel、ERC-20 currency、token decimals 规则；
6. canonical Multicall3 address/deployment lower bound；
7. 两个 Archive endpoint 的历史 `eth_chainId`、block header、StateView、
   Multicall3 bounded check；
8. 初始 pool/token fixture 的 hooks、fee、tickSpacing、PoolId、部署下界。

只接受官方源码/文档和链上读取作为真值。排名站点、Graph、搜索结果只能
作为候选输入。所有未验证地址必须标成 `VERIFY_REQUIRED`，不能进入 runtime
manifest。没有足够证据时停在本 package 并报告阻塞点。

## Package 2 — 目录规划与共享 seam

设计并记录最小目录迁移：

```text
src/defi/uniswap/shared/  # 仅真正复用的 address/PoolId/price primitives
src/defi/uniswap/v3/      # V3-only codec/service/registry/definition
src/defi/uniswap/v4/      # V4-only StateView/PoolKey/service/registry
src/domain/               # 独立 V3/V4 public models and configuration
src/rpc/                  # shared transport/executor/multicall port
```

优先保持现有 V3 文件路径，通过薄 re-export 兼容旧 import。只提取已被
V3/V4 双方使用且可独立测试的代码；不得将 V3 ABI、Factory 假设、fee-tier
语义或 USD 逻辑塞入共享层。不得增加 `utils/base/common/manager`。

交付：架构 diff、依赖方向图和需要更新的 export 清单。未获批准时不改源码。

## Package 3 — V4 domain contract、配置和 manifest 骨架

建议文件（按实际责任调整）：

- `src/domain/configuration.ts`：`UniswapV4Configuration`、严格 schema、默认值；
- `src/domain/errors.ts`：V4 unavailable/deployment error（必要时）；
- `src/domain/uniswapV4HistoricalPriceModels.ts`：request/result/failure；
- `src/defi/uniswap/v4/UniswapV4PoolDefinition.ts`；
- `src/defi/uniswap/v4/uniswapV4PoolRegistry.ts`；
- `src/index.ts`：公开类型/服务 exports；
- 聚焦 domain/config/registry tests。

验证 PoolKey 全字段、canonical currency order、PoolId、address/bytes32、
hooks、fee/tickSpacing、decimals、deployment metadata、stateSource 和
唯一 identity。manifest 必须 frozen、versioned、deterministically sorted。
初始 registry 宁可很小；不填猜测地址。配置关闭时现有客户构造行为必须
完全不变，unknown keys、错误 timeout 和无 endpoint 必须在 RPC 前失败。

## Package 4 — V4 PoolKey/PoolId 和 StateView codec

建议文件：

- `src/defi/uniswap/shared/UniswapPoolId.ts`；
- `src/defi/uniswap/v4/UniswapV4PoolKeyCodec.ts`；
- `src/defi/uniswap/v4/UniswapV4StateViewCodec.ts`；
- `tests/unit/uniswap-v4-pool-key.test.ts`；
- `tests/unit/uniswap-v4-state-view-codec.test.ts`。

实现纯函数：PoolKey ABI encoding、PoolId keccak、address/bytes32 校验、
StateView calldata selector、exact return tuple 长度、uint160、signed int24、
uint24/uint16 等 bounded fields。测试成功 fixture、native currency、错误
排序、错误 hooks、错误 poolId、短/长/非 canonical ABI、负 tick、边界 tick。

如果 Package 1 证明 StateView 不能满足历史读取，停止并提出独立的
`extsload` codec 设计；不得在本 package 偷换为 storage layout 猜测。

## Package 5 — 共享数学和 V3 回归保护

仅在 Package 2 设计获批后提取共享能力：

- `src/defi/uniswap/shared/UniswapPriceMath.ts`；
- V3 原路径的薄兼容导出或最小适配；
- `tests/unit/uniswap-price-math.test.ts`；
- 更新现有 V3 math tests，确保输出不变。

共享模块负责 BigInt ratio、token direction、decimal normalization、18 位
floor、exact rational、tick boundary；不负责 manifest、RPC、StateView、USD
选择。覆盖 zero/positive/negative tick、token0/token1 inversion、极小值、
invalid decimals 和不允许的浮点实现。先跑全部 V3 相关测试，再进入 V4 service。

## Package 6 — V4 历史价格 service 与 poolId 去重

建议文件：

- `src/defi/uniswap/v4/UniswapV4HistoricalPriceService.ts`；
- `tests/unit/uniswap-v4-historical-price-service.test.ts`。

service 只依赖现有 `multicallAtBlock()` port 和注入 manifest，不依赖 HTTP、
环境变量或 endpoint pool。每个 distinct poolId 构造一个 StateView call；
同 pool 的多个 token 映射一次状态结果。保留 request order 或明确 stable
manifest order，summary 准确报告 pool/batch 数。

必须覆盖：单 token、多 token、共享 pool 去重、不同 fee/tickSpacing/hooks、
token0/token1 base、native policy、pre-deployment filtering、call revert、
malformed response、wrong poolId、负/正 tick、部分成功、全失败、abort、
exact block propagation 和 raw payload 不泄漏。endpoint-level failure 不能
伪装成 token failure。

## Package 7 — Client composition 与 Archive RPC 复用

建议文件：

- `src/client/EvmDataClient.ts`；
- `src/domain/configuration.ts`（仅必要调整）；
- `tests/unit/client.test.ts` 与 config/Archive composition tests；
- 共享 RPC 文件只在确有 chain/state 参数需求时调整。

创建 nullable opt-in `client.uniswapV4`，复用现有 Archive transport、pool、
executor、RpcService 和 Multicall3 codec。不得新增 retry/client。初始化
通过 `client.initialize()`，构造函数无网络工作；配置完全相同才可共享 pool，
并证明 state/chain/deployment settings 不会串用。wrong chain、disabled、
custom endpoint redaction、endpoint pinning、abort 都要测。

## Package 8 — Public exports、offline verification 和文档同步

新增 package smoke import、V4 public type tests、manifest determinism、strict
unknown-key tests、Multicall/PoolManager/StateView deployment boundary tests。
同步 `docs/SPEC.md`、`docs/ARCHITECTURE.md`、`docs/INTEGRATIONS.md`、
`docs/DECISIONS.md`、`docs/NEXT_SESSION.md` 和本目录文档状态。

离线验证顺序：

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:package
pnpm check
```

第一次失败即停止并修复；默认测试不得访问网络、环境凭据或真实 manifest
更新命令。

## Package 9 — 受控 live smoke 和 handoff

仅在所有离线验证通过且 owner 明确批准后，用最多两个已验证 Archive
endpoint、一个 fixture block 和极少 pool 做 smoke。输出仅允许 chain、
stable endpoint ID、block、counts、batch count 和 error codes；不得打印
URL、PoolKey raw calldata、return data、价格、余额或 credentials。

单独运行 manifest updater，审核生成 diff；排名快照不应单独改变 registry。
最后在 `docs/NEXT_SESSION.md` 记录已完成包、测试命令、未验证事实、回滚/兼容
风险和下一步。不要 git reset、不要回滚用户改动、不要 push 或重写历史。

## Definition of Done

- 每个 package 的验收通过，新增源码和测试职责清晰；
- V3 现有行为和 exports 未回归；
- V4 ABI/部署/manifest 事实有证据，不存在猜测生产地址；
- exact historical block、poolId 去重、BigInt math 和 failure boundary 有测试；
- 所有 root checks 通过且默认离线；
- 权威文档与本目录状态一致；
- 变更可由下一次 AI session 无会话历史地继续。
