# Blockscout Provider 升级说明

状态：实现已落地，待维护者按部署目标补充 live smoke。  
目标版本：v0.5 provider extension

## 1. 目标

SDK 增加内置 `blockscout` provider。Blockscout 的 Explorer API
`module=account` 契约与 Etherscan API 基本兼容，因此 SDK 对调用方继续暴露
现有统一方法和统一模型：

```ts
const client = new EvmDataClient({
  providers: [
    { kind: "blockscout", apiKeys: [process.env.BLOCKSCOUT_API_KEY!],
      baseUrl: "https://eth.blockscout.com/api" },
  ],
});

const page = await client.address.getTransactions({
  chain: "ethereum",
  address: "0x1111111111111111111111111111111111111111",
  pageSize: 50,
});

const balance = await client.address.getNativeBalance({
  chain: "ethereum",
  address: "0x1111111111111111111111111111111111111111",
});

const transfers = await client.token.getErc20Transfers({
  chain: "ethereum",
  address: "0x1111111111111111111111111111111111111111",
  direction: "both",
});
```

结果仍然是 `Page<Transaction>`、`NativeBalance` 和 `Page<Erc20Transfer>`。
结果中的 `pageInfo.provider`/`item.provider` 为 `"blockscout"`，数量和区块均
保持十进制字符串，继续使用 SDK 自己的 opaque cursor。

## 2. 配置和路由

`ProviderConfiguration` 新增：

```ts
interface BlockscoutConfiguration extends ProviderConfigurationBase {
  readonly kind: "blockscout";
}
```

`baseUrl` 是一个 Blockscout Etherscan-compatible `/api` endpoint。它不包含
用户名、密码、query 或 fragment，生产环境必须 HTTPS；本地测试可显式设置
`allowInsecureHttp: true`。当省略 `baseUrl` 时，Ethereum 内置 chain route 使用
`https://eth.blockscout.com/api`。其它网络必须先通过对应 chain 的
`routes.blockscout.apiUrl` 显式声明支持，SDK 不猜测网络域名。Provider
`baseUrl` 只覆盖已声明 route 的请求地址，不会把一个单链 endpoint 扩展到其它 chain。

```ts
const client = new EvmDataClient({
  providers: [
    { kind: "etherscan", apiKeys: ["eth-key-1", "eth-key-2"] },
    { kind: "blockscout", apiKeys: ["bs-key-1", "bs-key-2"],
      baseUrl: "https://my-chain.blockscout.com/api" },
  ],
});
```

每个 provider 配置项生成独立的 `CredentialPool`（例如
`blockscout-2-key-1`）。请求只会从 capability 匹配的 provider 中选择：

- 只有 Blockscout 配置时，只使用 Blockscout 的 key pool；
- Etherscan 和 Blockscout 都配置时，router 按配置顺序尝试，认证失败、限流、
  网络故障等由现有 bounded retry policy 触发 key/provider fallback；
- continuation cursor 会继续 pin 到原 provider configuration，不会跨 provider
  拼接分页数据；
- `fullData` 允许 Etherscan 或 Blockscout，Alchemy/Moralis 仍不满足该语义；
- provider URL、API key、proxy URL 和上游原始错误不会出现在 public result、cursor
  或异常 message 中。

## 3. 兼容范围

Blockscout adapter 复用 Etherscan-compatible response schema 和 mapper，支持：

| SDK 方法 | 上游 action |
| --- | --- |
| `getTransactions` | `account/txlist` |
| `getNativeBalance` | `account/balance` |
| `getErc20Transfers` | `account/tokentx` |
| `getErc20TransfersByBlockRange` | `account/tokentx` + SDK range scanner |
| `getErc20BalanceAtBlock` | `account/tokenbalancehistory`（实例需支持时） |
| `getErc20TokenHoldings` | `account/addresstokenbalance`（实例需支持时） |
| block timestamp lookup | `block/getblocknobytime` |

请求使用 `apikey` query parameter。Blockscout 实例可能关闭某些 endpoint、要求
额外计划权限或返回与 Etherscan 不同的 logical error 文本；这些情况必须经过
schema/error classifier 转换成 SDK 的统一 `EvmDataError`，不能把原始 payload
透传给调用方。交易 receipt context、NFT、内部 trace 等不因为“兼容”声明而
自动启用，除非后续单独验证并补充 capability。

## 4. 验收标准

- `kind: "blockscout"` 通过严格配置解析并公开导出；未知字段和无效 URL 在网络
  请求前失败。
- Blockscout request/response 与 Etherscan 的 SDK 方法和 domain model 一致，
  provenance 稳定为 `blockscout`。
- 多 key 轮换、provider fallback、cursor pinning、proxy/retry、secret redaction
  继续由已有执行层负责，不在 adapter 内新增 retry loop。
- 默认单元测试完全离线，覆盖 Blockscout URL、apikey、空结果、错误分类、分页、
  only-Blockscout 和 Etherscan->Blockscout fallback。
- `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm test:package`
  全部通过。
- live smoke 由维护者显式执行，只记录 chain、stable provider name、counts 和
  error codes；不得记录 key、URL、完整 query 或原始响应。

## 5. 非目标和后续扩展

本次不新增 Blockscout v2 REST `/api/v2` 专用模型，不把它与 Etherscan 的语义
不一致 endpoint 伪装成同一操作，也不加入运行时网络发现。需要支持没有
Etherscan-compatible API 的 Blockscout 实例时，另起 provider-specific operation
和文档，不修改现有统一契约。
