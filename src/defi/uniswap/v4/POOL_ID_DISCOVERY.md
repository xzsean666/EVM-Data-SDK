# Uniswap V4 PoolId Discovery

`PoolId` 不能由 token symbol、V3 pool address 或 fee 单独推导。V4 的真值
来自完整的 `PoolKey`：

```text
currency0, currency1, fee, tickSpacing, hooks
```

本仓库只把经过链上验证的结果写入 `uniswapV4PoolRegistry.ts`。

## 1. 固定官方部署

Ethereum Mainnet 的官方部署：

```text
PoolManager: 0x000000000004444c5dc75cB358380D2e3dE08A90
StateView:   0x7ffe42c4a5deea5b0fec41c94c136cf115597227
```

`StateView.getSlot0(bytes32)` selector 是 `0xc815641c`，返回：

```text
(uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, uint24 lpFee)
```

## 2. 发现候选 PoolId

市场数据站点只能用于发现候选值。候选池必须满足：

1. `pairAddress` 是 32-byte hex，作为候选 `PoolId`；
2. pair 的 chain 是 Ethereum，DEX 是 Uniswap V4；
3. 通过 PoolManager 的 `Initialize` 事件确认完整 PoolKey。

PoolManager `Initialize` event：

```solidity
event Initialize(
  bytes32 indexed id,
  Currency currency0,
  Currency currency1,
  uint24 fee,
  int24 tickSpacing,
  IHooks hooks,
  uint160 sqrtPriceX96,
  int24 tick
);
```

事件 topic：

```text
0xdd466e674ea557f56295e2d0218a125ea4b4f0f6f3307b95f85e6110838d6438
```

按候选 `PoolId` 查询 `eth_getLogs`，并使用不超过 10,000 blocks 的范围。日志
必须满足：

```text
log.address == PoolManager
log.topics[1] == candidatePoolId
```

`topics[2]`、`topics[3]` 是 canonical `currency0`/`currency1`；data 的四个
首字段依次是 `fee`、`tickSpacing`、`hooks`、初始 `sqrtPriceX96`，随后是初始
tick。native currency 使用 zero address sentinel，不能改成 WETH。

## 3. 计算与验证

使用官方 `PoolIdLibrary.toId(poolKey)` 的 keccak-256 ABI 编码计算 PoolId，
并要求计算值等于 `Initialize` 的 indexed `id`。不要使用 SHA-256。

然后在同一个历史 block 调用：

```text
to:   StateView
data: 0xc815641c + poolId(32-byte)
tag:  Initialize event block 或更晚的精确 block
```

返回必须通过 uint160、signed int24、uint24 边界校验。只有这三项都通过时，
才可以把条目写入 registry，并填写 `poolDeploymentBlock`。

## 4. Registry entry

示例（ASTR/USDC，已通过上述流程验证）：

```ts
{
  tokenSymbol: "ASTR",
  currency0: { address: USDC, kind: "erc20", symbol: "USDC", decimals: 6 },
  currency1: { address: ASTR, kind: "erc20", symbol: "ASTR", decimals: 18 },
  fee: 150000,
  tickSpacing: 1500,
  hooks: "0x000000000000000000e1cdf458d9af257c6441980",
  poolId: "0xd469b123a48fbc668b6cc17f74a63b2422418a1c2cf29d81cce8b3d242912415",
  poolDeploymentBlock: "25707989",
  stateSource: "state-view",
}
```

同一 token 可能有多个 V4 pools。每个不同 PoolId 都是独立条目；不能因为
token pair 相同而去重。

## 5. Checklist

- [ ] Ethereum chainId 为 `1`；
- [ ] PoolManager/StateView code 在 deployment block 存在；
- [ ] Initialize event 的 PoolId 与候选值一致；
- [ ] PoolKey 字段顺序、currency canonical order、hooks、fee、tickSpacing 已记录；
- [ ] StateView 在目标历史 block 返回合法 slot0；
- [ ] token decimals 通过 ERC-20 `decimals()` 或官方 metadata 验证；
- [ ] URL、calldata、return data、credentials 不写入 public result、日志或 fixture。
