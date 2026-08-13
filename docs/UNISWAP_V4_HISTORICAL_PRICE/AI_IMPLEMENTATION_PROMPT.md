# Uniswap V4 Historical Price Implementation Prompt

将下面的 prompt 连同仓库访问权限交给 Claude Sonnet 5 或 ChatGPT Terra。

```text
你是 /home/sean/git/EVM-Data-SDK 的实现工程师。任务是按
docs/UNISWAP_V4_HISTORICAL_PRICE/UPGRADE.md 为 SDK 增加 Ethereum Mainnet
Uniswap V4 historical price，并严格执行同目录 TASK_BREAKDOWN.md。当前这
一轮文档已经写好；不要假设任何 V4 address、ABI、PoolId 或 deployment
block 已经验证。

开始前必须完整阅读，顺序如下：
  Agent.md
  docs/SPEC.md
  docs/ARCHITECTURE.md
  docs/BUILD.md
  docs/INTEGRATIONS.md
  docs/DECISIONS.md
  docs/NEXT_SESSION.md
  docs/UNISWAP_V3_HISTORICAL_PRICE/README.md
  docs/UNISWAP_V3_HISTORICAL_PRICE/UPGRADE.md
  docs/UNISWAP_V3_HISTORICAL_PRICE/TASK_BREAKDOWN.md
  docs/UNISWAP_V4_HISTORICAL_PRICE/README.md
  docs/UNISWAP_V4_HISTORICAL_PRICE/UPGRADE.md
  docs/UNISWAP_V4_HISTORICAL_PRICE/TASK_BREAKDOWN.md

先只做 Step 0 Context Discovery 和 Step 1 Architecture Design，并报告：
  - 当前 EvmDataClient、configuration、public exports、RpcService、Archive
    transport/pool/executor、Multicall3、V3 service/registry/math 的边界；
  - V3/V4 哪些能力可以安全共享，哪些必须保持 protocol-specific；
  - 准确的拟修改文件和目录迁移方案；
  - PoolManager、StateView、PoolKey/PoolId、currency、ABI、deployment 和
    Archive endpoint 仍缺的外部证据；
  - data flow、failure boundary、security risk 和测试 seam。

没有 owner approval 时，不编辑 src/、不安装依赖、不运行会写入 manifest 的
命令。即使任务上下文已经授权实施，也先给出报告，并在开始 Package 1 前
明确授权假设。使用 apply_patch；不要 git reset、checkout、回滚用户改动、
push 或重写历史。

核心目标：新增 opt-in nullable service
  client.uniswapV4: UniswapV4HistoricalPriceService | null

目标 public usage 与 V3 对齐：
  client.uniswapV4!.getTokenPricesAtBlock({
    chain: "ethereum" | 1,
    blockNumber: canonical decimal string,
    tokenIds?: string[],
    tokenPair?: [string, string],
    signal?: AbortSignal,
  })
  client.uniswapV4!.getTokenPriceAtBlock(...)
  client.uniswapV4!.getTokenPricesAtBlockUsd(...)

V4 不是 V3 的改名版。V4 是 Singleton PoolManager：一个 Pool 由完整
PoolKey(currency0, currency1, fee, tickSpacing, hooks) 和 PoolId 标识；没有
每池 V3 slot0() 合约，也不能用 V3 Factory getPool、fee-tier registry、pool
address 或 V3 slot0 selector 作为 V4 真值。必须先从官方 v4-core/v4-periphery
源码/文档和链上证据验证：
  - Ethereum PoolManager 地址和 deployment lower bound；
  - StateView 地址、deployment lower bound、exact state getter selector/ABI；
  - PoolKey field order、canonical currency sorting、PoolId ABI/keccak；
  - state getter 的 sqrtPriceX96、signed tick、fee/protocolFee 返回语义；
  - native ETH sentinel、ERC-20 currency 和 decimals；
  - Multicall3 地址/deployment boundary；
  - 每个初始 fixture pool 的 PoolKey、PoolId、hooks、fee、tickSpacing、
    decimals 和 deployment block；
  - 至少两个能读取历史 StateView/Multicall3 的 Archive endpoints。
 把来源和结果写入 docs/INTEGRATIONS.md。未经验证的值只能写
 VERIFY_REQUIRED，不能进入运行时 manifest。排名、Graph 或搜索页面只能
 发现候选，不能作为 pool truth。

目录规则：
  src/domain/uniswapV3HistoricalPriceModels.ts  # 保持现有 V3 public model
  src/domain/uniswapV4HistoricalPriceModels.ts  # 独立 V4 public model
  src/defi/uniswap/shared/                      # 只有真实共用的纯 primitives
  src/defi/uniswap/v3/                          # V3 ABI/service/registry
  src/defi/uniswap/v4/                          # V4 codec/service/registry
  src/rpc/                                      # 共享 transport/executor/multicall

如果为了共享而移动 V3 文件，必须保留薄兼容 re-export，先证明 V3 输出不变，
并避免无关大重构。共享层可以放 address validation、PoolId/identity primitive、
BigInt price math、fixed decimal renderer；不能放 V3 slot0 ABI、V4 StateView
ABI、Factory 发现、V4 hook 语义或无边界的 utils/base/common/manager。

实现约束：
  - 复用 ArchiveRpcTransport、EthereumArchiveRpcPool、
    EthereumArchiveRpcExecutor、RpcService 和 EthereumMulticall3Codec；
  - 不增加 ethers、viem、第二个 HTTP client、第二套 retry、cache、proxy
    routing 或 background health timer；
  - V4 service 只依赖注入的 multicallAtBlock port 和 frozen manifest，不读
    env、不访问网络、不做 runtime discovery；
  - 每个 distinct poolId 只发一个 allowFailure StateView call；不同 fee、
    tickSpacing 或 hooks 即使 token pair 相同也不能去重；
  - 所有调用使用同一个精确历史 block tag，endpoint operation pinning 和
    full-operation retry 由现有 RPC layer 负责；绝不能 fallback 到 latest；
  - PoolManager/StateView/Multicall3 deployment boundary 在 RPC 前检查；
  - public integers 是十进制字符串；BigInt 负责平方、反转、decimal normalize、
    18 位 floor 和 exact rational；禁止 Number、Math.pow、浮点 tick formula；
  - native ETH 与 WETH 不可静默等同。若 v0.1 只支持 ERC-20，必须在 validator
    和 resolver 中显式拒绝 native entries；
  - pool call revert、未部署和 malformed state 是 per-token failure；Archive
    exhaustion、wrong chain、reorg、abort、malformed Multicall3 和 deployment
    boundary 是 operation-level typed error；全失败抛出
    UNISWAP_V4_PRICE_DATA_UNAVAILABLE；
  - URL、API key、proxy、calldata、return data、raw provider error、余额和
    secrets 绝不进入 public result、error、log、cursor、fixture 或 telemetry。

建议按 TASK_BREAKDOWN.md 执行这些包：
  Package 0: context/architecture report；
  Package 1: external facts and ABI evidence；
  Package 2: shared/V3/V4 directory seams；
  Package 3: V4 domain/config/manifest；
  Package 4: PoolKey/PoolId/StateView codecs；
  Package 5: shared BigInt math plus V3 regression protection；
  Package 6: V4 historical service and poolId deduplication；
  Package 7: client composition and Archive reuse；
  Package 8: exports, offline verification and canonical docs；
  Package 9: owner-approved bounded live smoke and handoff。

至少测试：
  - strict config defaults/unknown keys/timeout relationship/endpoint redaction；
  - PoolKey canonical ordering、PoolId deterministic hash、hooks/fee/tickSpacing；
  - StateView selector、exact ABI tuple、uint160、signed int24、malformed data；
  - native/erc20 policy、manifest duplicate/metadata/deployment validation；
  - one token、many tokens、shared poolId dedup、same pair different hook/fee；
  - token0/token1 direction、positive/negative tick、18-decimal floor、exact ratio；
  - pre-deployment no-RPC、revert/malformed per-pool failure、all-failure rejection；
  - exact block propagation、batch count、abort、endpoint failure classification；
  - client.uniswapV4 null when disabled、constructor no network、public exports、
    package smoke、V3 tests unchanged、no secret/raw payload leakage。

离线命令按以下顺序执行，第一次失败就停止：
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm build
  pnpm test:package
  pnpm check

只有离线检查全部通过并获得 owner approval 后，才可对最多两个已验证
Archive endpoints 做 bounded live smoke。smoke 输出只能包含 chain、stable
endpoint ID、block、counts、batch count 和 error codes；不得输出 URL、raw
calldata、return data、price、balance 或 credentials。完成后更新
docs/NEXT_SESSION.md、docs/SPEC.md、docs/ARCHITECTURE.md、docs/INTEGRATIONS.md、
docs/DECISIONS.md 和本目录文档，使状态一致，并报告未验证事实和后续工作。
```
