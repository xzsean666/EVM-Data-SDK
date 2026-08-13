# Uniswap V4 Historical Price 升级文档

版本：0.1.0 proposal
状态：架构与实施规格；本次只提交文档，不修改源码
初始网络：Ethereum Mainnet，EIP-155 chain ID `1`

## 1. 目标

新增一个只读的 `client.uniswapV4` 服务，用于在一个精确的历史区块读取
Uniswap V4 pool 的即时价格。它的调用习惯、批量请求、失败分类、Archive
RPC 约束和公共结果风格应与现有 `client.uniswapV3` 一致，但底层数据模型
必须遵守 V4 的 Singleton 设计：多个 pool 由一个 `PoolManager` 管理，pool
由完整 `PoolKey` 确定，状态通过 V4 的状态读取入口获取。

目标数据流：

```text
decimal block number
  -> exact historical block tag
  -> Ethereum Archive RPC + Multicall3
  -> V4 StateView.getSlot0(poolId) (or approved direct extload seam)
  -> sqrtPriceX96 + signed tick
  -> shared integer price math
  -> token exchange-rate result
```

这是 pool 在该区块的 instantaneous spot state，不是 candle、成交均价、
TWAP、预言机价格或跨池共识价格。V4 hooks、动态费率、不同 currency
表示方式和 native ETH 语义必须在 manifest 中显式建模，不能被隐式忽略。

## 2. 与 V3 的关系和边界

### 2.1 保持一致的使用方式

V4 服务建议提供与 V3 对齐的方法族：

```ts
client.uniswapV4!.getTokenPricesAtBlock({
  chain: "ethereum",
  blockNumber: "19000000",
  tokenIds: ["ethereum:uniswap-v4:..."],
});

client.uniswapV4!.getTokenPriceAtBlock({
  chain: "ethereum",
  blockNumber: "19000000",
  token: "USDC",
});

client.uniswapV4!.getTokenPricesAtBlockUsd({
  chain: "ethereum",
  blockNumber: "19000000",
  tokens: ["USDC", "WETH"],
});
```

具体 selector 字段以仓库现有 V3 公共类型为基线，但 V4 的 token ID、pool
identity、state source 和配置必须是独立类型。不得为了“复用”而把 V4
请求强制转换成 `UniswapV3HistoricalPriceRequest`。

### 2.2 必须独立验证的 V4 事实

在实现前，必须从 Uniswap 官方 v4-core/v4-periphery 文档、已验证源码和
链上部署确认以下事实，并把来源、区块、方法签名和证据记录到
`docs/INTEGRATIONS.md`：

- Ethereum Mainnet `PoolManager` 地址、部署区块和代码存在性；
- `StateView`（或批准的替代状态读取合约）地址、部署区块和 ABI；
- `PoolKey` 字段顺序、类型、currency 排序要求和 `PoolId` 哈希编码；
- `StateView` 的 `getSlot0`/等价方法的 selector、返回 tuple、signed tick
  编码和 fee/protocolFee 语义；
- V4 `Currency` 对 native ETH、ERC-20 和 zero address 的表示规则；
- 初始 manifest 中每一个 pool 的两种 currency、fee、tickSpacing、hooks、
  poolId、token decimals、部署下界和可读名称；
- Multicall3 地址和部署边界；仓库已有 Ethereum 值只能作为待复核事实；
- 至少两个 Archive endpoint 能在历史区块读取状态入口。

在这些事实未验证前，文档中的地址只能写作 `VERIFY_REQUIRED`，不能提交
伪造或猜测的生产 manifest。V4 不应使用 V3 Factory `getPool` 作为发现或
真值来源。

## 3. Scope

### v0.1 包含

- Ethereum Mainnet only (`chainId: 1`)；
- 非负十进制字符串精确 block number，拒绝 JS number、hex、负数和小数；
- 静态、版本化、人工审核的 V4 pool/token manifest；运行时不扫描 Factory；
- 一个请求包含一个或多个 token，按 `poolId` 去重状态读取；
- 通过现有 `RpcService.multicallAtBlock()` 使用 Multicall3，按配置拆批；
- 默认使用已验证的 V4 `StateView` view call。若 `StateView` 不支持需要的
  历史读取，必须先批准并实现一个独立的 V4 `extsload` codec，不能在服务
  中拼接 storage slot；
- pool 级部分成功：单个 pool 未部署、状态 call revert 或返回数据无效时，
  只产生对应 token failure；Archive/RPC/一致性错误仍为操作级错误；
- 与 V3 相同的 BigInt、18 位 floor 输出、精确 numerator/denominator；
- 稳定 `rpcEndpointId`，不泄漏 URL、calldata、return data 或 credentials；
- `client.uniswapV4` 默认 `null`，只在 `uniswapV4.enabled` 时创建。

### 明确排除

- 其他链、L2、测试网和跨链聚合；
- 运行时 pool discovery、Graph/REST 排名、动态 hook 枚举；
- 从 V3 Factory 或 V4 PoolManager 事件自动生成 manifest；
- TWAP、历史 observation 查询、流动性/深度排序、multi-pool averaging；
- 通过 hook 自定义费率推导“真实成交价格”；
- 把 native ETH 和 WETH 静默视为同一资产；
- 为 V4 复制一套 HTTP client、retry loop、Archive executor 或 Multicall3；
- 未经验证的 V4 地址、ABI、PoolId 或 token metadata。

## 4. 公共 API 契约

### 4.1 配置

建议新增：

```ts
interface UniswapV4Configuration {
  readonly enabled?: boolean;
  /** Enabled feature defaults to the verified Ethereum Archive candidates. */
  readonly useBuiltinEthereumArchiveRpcs?: boolean;
  readonly rpcEndpoints?: readonly EthereumArchiveRpcEndpointConfiguration[];
  readonly healthCheckTimeoutMs?: number;
  readonly attemptTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxCallsPerMulticall?: number;
  readonly maxRpcAttempts?: number;
}
```

配置必须复用现有 endpoint 类型、归一化规则、超时关系和 redaction。V4
可以复用已创建且配置完全相同的 Archive pool，但不能因为复用而混淆
chain、Multicall deployment、StateView 地址或 endpoint identity。构造函数
不得发网络请求。

### 4.2 请求

公共请求应与 V3 对齐，但 token selector 必须指向 V4 manifest：

```ts
interface UniswapV4HistoricalPriceRequest {
  readonly chain: 1 | "ethereum";
  readonly blockNumber: string;
  /** Omitted means every enabled V4 manifest entry. */
  readonly tokenIds?: readonly string[];
  /** Two explicit currency/token selectors; order-independent. */
  readonly tokenPair?: readonly [string, string];
  readonly signal?: AbortSignal;
}
```

要求：规范化前导零；拒绝空数组、重复 token ID、未知 ID、错误 chain、
`tokenIds` 与 `tokenPair` 同时出现、相同 pair 两侧和不明确 symbol。所有
pool 状态读取使用同一个请求 block。请求无 selector 时读取已启用的、经过
审核的 manifest，不是扫描链上全部 V4 pools。

### 4.3 Pool identity 和 manifest

V4 token definition 至少需要：

```ts
interface UniswapV4PoolDefinition {
  readonly id: string;
  readonly chainId: 1;
  readonly protocol: "uniswap-v4";
  readonly tokenAddress: string;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly currency0: UniswapV4Currency;
  readonly currency1: UniswapV4Currency;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly hooks: string;
  readonly poolId: string;
  readonly quoteCurrencyAddress: string | null;
  readonly poolDeploymentBlock: string;
  readonly stateSource: "state-view";
}

interface UniswapV4Currency {
  /** zero address only when verified as the V4 native currency sentinel */
  readonly address: string;
  readonly kind: "native" | "erc20";
  readonly symbol: string;
  readonly decimals: number;
}
```

`currency0`/`currency1` 必须是 V4 canonical ordering，而不是按 token symbol
排序。`poolId` 必须由完整 `PoolKey` 独立计算并和链上/官方 fixture 比对；
不能只用 token pair、fee 或 pool address 当作 identity。`hooks`、fee、
tickSpacing、native/erc20 kind 和 state source 都是 identity/语义的一部分。

建议目录和职责如下：

```text
src/domain/
  uniswapV3HistoricalPriceModels.ts       # 现有 V3 public contract
  uniswapV4HistoricalPriceModels.ts       # V4 public contract
  configuration.ts                         # V3/V4 config sections
src/defi/uniswap/
  shared/
    UniswapAddressCodec.ts                 # address/bytes32 validation only
    UniswapPoolId.ts                       # shared hash/identity primitives
    UniswapPriceMath.ts                    # sqrt price, decimals, floor output
    UniswapHistoricalPriceService.ts       # only if a genuinely shared seam exists
  v3/
    UniswapV3Slot0Codec.ts                 # V3-only ABI
    UniswapV3HistoricalPriceService.ts     # V3 orchestration
    UniswapV3TokenDefinition.ts
    uniswapV3TokenRegistry.ts
  v4/
    UniswapV4StateViewCodec.ts             # V4-only ABI/return validation
    UniswapV4PoolKeyCodec.ts               # PoolKey/PoolId encoding
    UniswapV4HistoricalPriceService.ts     # V4 orchestration
    UniswapV4PoolDefinition.ts
    uniswapV4PoolRegistry.ts
src/rpc/
  RpcService.ts                             # shared exact-block Multicall3 port
```

迁移策略：先保持现有 V3 公共 import/export 和运行行为不变。只有在共享
模块能证明同时降低重复并有独立测试时，才把 V3 的 address、math、result
rendering 提取到 `shared/`；原 V3 路径可保留薄兼容 re-export，避免破坏
消费者。不要创建无职责的 `utils`、`base`、`manager` 文件，也不要为了
目录整洁进行无关的大规模重命名。

### 4.4 结果

V4 result 应与 V3 result 对齐，并补充 V4 provenance：

```ts
interface UniswapV4HistoricalPriceResult {
  readonly chainId: 1;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly blockTimestamp: string;
  readonly registryVersion: string;
  readonly rpcEndpointId: string;
  readonly executionMode: "multicall3-state-view";
  readonly stateSource: "state-view";
  readonly priceScale: 18;
  readonly prices: readonly UniswapV4HistoricalPrice[];
  readonly failures: readonly UniswapV4PriceFailure[];
  readonly summary: {
    readonly configuredPools: number;
    readonly requestedTokens: number;
    readonly succeededTokens: number;
    readonly failedTokens: number;
    readonly distinctPools: number;
    readonly multicallBatches: number;
    readonly partial: boolean;
  };
}

interface UniswapV4HistoricalPrice {
  readonly tokenId: string;
  readonly tokenAddress: string;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly poolId: string;
  readonly fee: number;
  readonly tickSpacing: number;
  readonly hooks: string;
  readonly currency0: UniswapV4Currency;
  readonly currency1: UniswapV4Currency;
  readonly baseCurrency: UniswapV4Currency;
  readonly quoteCurrency: UniswapV4Currency;
  readonly sqrtPriceX96: string;
  readonly tick: string;
  readonly price: string;
  readonly tickPrice: string;
  readonly ratioNumerator: string;
  readonly ratioDenominator: string;
  readonly priceRounding: "floor";
  readonly blockNumber: string;
}

type UniswapV4PriceFailureCode =
  | "POOL_NOT_DEPLOYED_AT_BLOCK"
  | "STATE_CALL_REVERTED"
  | "STATE_RESPONSE_INVALID"
  | "POOL_KEY_INVALID"
  | "PRICE_CALCULATION_INVALID";
```

如果官方 V4 ABI 返回的字段不叫 `sqrtPriceX96`/`tick`，codec 可以用内部
名称映射，但 public result 必须记录最终语义，并在 `INTEGRATIONS.md` 中
固定 ABI 证据。fee/protocolFee 不应被包装成 spot price 的一部分；动态
fee 只作为 state/provenance 字段，除非另有产品决策。

## 5. V4 ABI、状态读取和批量策略

### 5.1 StateView 优先

实现 agent 必须先验证 StateView 的官方接口和部署。目标是为每个 distinct
`poolId` 生成一个 `allowFailure: true` 的 view call，并由纯 codec 解码：

```ts
{
  id: `uniswap-v4::${poolId.toLowerCase()}`,
  target: VERIFIED_STATE_VIEW_ADDRESS,
  callData: encodeStateViewSlot0(poolId),
  allowFailure: true,
}
```

所有 pool call 可能指向同一个 StateView target，但调用参数必须由不同
poolId 区分。不得把 `poolId` 直接当作 EVM address。若 StateView 只能在
最新状态读取或无法返回指定历史状态，必须停止并提出 `extsload` 设计；
不能偷偷退回 `latest`。

### 5.2 Multicall3 和部署边界

复用 `RpcService.multicallAtBlock()`、现有 Archive transport/pool/executor
和 Multicall3 codec。请求 block 在 V4 PoolManager、StateView 和 Multicall3
读取中都必须保持一致；不能混合 endpoints 或 partial retry 结果。

在 RPC 之前检查：

- requested block >= 已验证的 Multicall3 deployment block；
- requested block >= V4 PoolManager/StateView deployment lower bound；
- manifest poolDeploymentBlock <= requested block。

部署边界应使用现有 typed error 或新增明确的 V4 deployment error，不能把
“合约尚未部署”误报成 `STATE_RESPONSE_INVALID`。

### 5.3 去重

一个请求中相同 `poolId` 只能发一个状态 call，再将结果映射到所有指向
该 pool 的 token entry。V4 `PoolId` 是去重主键；相同 token pair 但
fee/tickSpacing/hooks 任一不同，必须是不同 pool。结果顺序沿用请求顺序
或文档化的 manifest stable order，summary 的 `distinctPools` 和
`multicallBatches` 必须可预测。

## 6. 价格数学

优先提取与 V3 相同的纯共享数学模块；不改变 V3 已有输出语义。对有效
`sqrtPriceX96`，raw ratio 仍是：

```text
ratioRaw(currency1/currency0) = sqrtPriceX96^2 / 2^192
```

按 base/quote 方向和 decimals 做 BigInt 有理数归一化，18 位 display
使用 floor，保留 exact numerator/denominator。V4 tick 仍是 signed int24
语义，但必须以验证过的 V4 tick bounds 和 StateView ABI 解码。禁止
`Number`、`Math.pow`、`1.0001 ** tick` 或浮点平方。

native ETH 只有在产品明确允许时才可转换为 USD；不能因为 address 是
zero address 就复用 WETH 的 token metadata。若 v0.1 只支持 ERC-20/
ERC-20 pool，应在 manifest validator 和 request resolver 中显式拒绝
native entry，而不是静默映射。

## 7. 错误和安全边界

建议新增 `UNISWAP_V4_PRICE_DATA_UNAVAILABLE`，并复用已有 invalid request、
unsupported operation、Archive/RPC、abort 和 deployment errors。错误表：

| 条件 | 行为 |
| --- | --- |
| 输入、pair、未知 token ID 无效 | `INVALID_REQUEST`，不发 RPC |
| feature 未启用 | 沿用 client 的 `UNSUPPORTED_OPERATION`/配置约定 |
| block 早于 Multicall3/PoolManager/StateView | typed deployment error，不发 pool call |
| StateView call revert/empty result | 对应 token 加 `STATE_CALL_REVERTED` |
| ABI、PoolId、signed tick 或 currency metadata 无效 | 对应 token failure，不泄漏 return data |
| BigInt/decimals/方向计算失败 | `PRICE_CALCULATION_INVALID` |
| 所有 selected token 都失败 | `UNISWAP_V4_PRICE_DATA_UNAVAILABLE` |
| Archive exhaustion、wrong chain、reorg、abort、恶意 Multicall response | 操作级 typed error，不返回 partial result |

硬性约束：exact block tag、direct-only、one-endpoint pinning、full operation
retry、无 background timer、无 cache、无 hidden env read、无 raw RPC logging。
public integer 用 decimal string；URL、key、proxy、calldata、return data、
池余额和原始 provider error 全部 redacted。

## 8. 验收标准

1. `client.uniswapV4` 是 opt-in、Ethereum-only、公开类型完整且默认不
   产生网络请求。
2. V3 原有测试和行为保持不变；共享提取有兼容 export 或已记录迁移。
3. V4 manifest 的 PoolKey、PoolId、currency 排序、hooks、fee、tickSpacing、
   decimals、deployment metadata 都有离线 fixture 验证。
4. 一个 batch 请求按 poolId 去重，所有读取使用精确历史 block tag，结果
   报告 pool 数和 batch 数。
5. StateView/approved state codec 对 selector、ABI 长度、signed tick、
   invalid bool/bytes32 等异常 fail closed。
6. spot price、tick price、方向反转、decimal normalization、18 位 floor
   和 exact rational 有确定性单元测试。
7. pool failure 与 endpoint failure 分类正确，无敏感信息或 raw payload
   泄漏；全失败请求抛出 V4 typed unavailable error。
8. `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、
   `pnpm test:package`、`pnpm check` 通过；默认测试不访问网络。
9. `docs/SPEC.md`、`docs/ARCHITECTURE.md`、`docs/INTEGRATIONS.md`、
   `docs/DECISIONS.md`、`docs/NEXT_SESSION.md` 和本目录文档状态一致。

## 9. 文档目录规范

本目录只放 V4 需求、拆分和 AI 交接文档；仓库权威事实仍由根级文档负责。
实现后的源码按 `src/defi/uniswap/{shared,v3,v4}` 组织，公共 API model
继续留在 `src/domain`，RPC 执行继续留在 `src/rpc`。任何新共享文件必须
有明确责任名和独立测试，不能以 `utils.ts`、`base.ts`、`common.ts` 作为
无边界收容处。V3 迁移只能通过兼容 re-export 和小步提交完成。
