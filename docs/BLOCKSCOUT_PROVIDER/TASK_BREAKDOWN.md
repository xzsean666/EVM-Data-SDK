# Blockscout Provider 任务拆分

这份队列用于交给 Claude Sonnet 5 或 ChatGPT Terra 执行。每个 package 完成后
先跑对应测试，再进入下一个 package；不能通过扩大重试或透传 payload 来绕过
验收标准。

## Package 0：上下文和外部契约确认

阅读 `Agent.md` 以及 `docs/SPEC.md`、`docs/ARCHITECTURE.md`、`docs/BUILD.md`、
`docs/INTEGRATIONS.md`、`docs/DECISIONS.md`、`docs/NEXT_SESSION.md`。核对目标
Blockscout 实例的 Etherscan-compatible 文档，至少确认 `/api` base URL、
`apikey` 位置、`account/txlist`、`balance`、`tokentx` 的字段和空结果语义。

输出：实现前的 Step 0/Step 1 报告、外部证据链接和未验证的 endpoint 清单。
不要在此 package 安装依赖或修改 `src/`。

## Package 1：domain/configuration/chain route

修改：

- `src/domain/chains.ts`：`BuiltinProviderName`、`BlockscoutRoute`、route schema；
- `src/chains/builtinChains.ts`：只加入已经确认的内置 route（当前 Ethereum）；
- `src/domain/configuration.ts`：`BlockscoutConfiguration`、严格 discriminated union、
  normalization；
- `src/index.ts`：公开配置和 route 类型。

验收：Blockscout 可以单独构造；adapter 规范化 `baseUrl` 尾斜杠并拒绝凭据/
query/不安全 HTTP（除 loopback/显式 opt-in）；`baseUrl` 不能绕过 chain route
capability；无 provider 配置时仍保持原有 invalid configuration。

## Package 2：Etherscan-compatible adapter

修改或复用：

- `src/providers/blockscout/BlockscoutAdapter.ts`；
- `src/providers/etherscan/EtherscanAdapter.ts`、mapper/error classifier 的共享
  provider identity seam；
- `src/client/EvmDataClient.ts` 的 adapter factory 和 test adapter 类型。

实现原则：adapter 只做一次 upstream attempt；请求使用 `module=account`、对应
`action`、`apikey`，Blockscout 不强行发送 Etherscan `chainid`；分页 state 仍由
SDK cursor codec 包装。Provider-specific schema、错误和映射必须留在 provider
目录，返回统一 domain model，数量使用十进制字符串。

验收：transactions、native balance、ERC-20 transfer、block-range window、可用
时的历史余额/holdings 和 timestamp lookup 均有 fixture；malformed response、
HTTP 401/403/429/5xx、invalid key、rate limit、empty result 均映射到安全错误。

## Package 3：router/execution/provider pools

修改：

- `src/execution/ProviderRouter.ts`：full-data capability 允许 Etherscan/Blockscout；
- 仅在测试暴露需要的 seam，不复制 `RequestExecutor`、`CredentialPool`、`RetryPolicy`。

验收：

- 只有 Blockscout 时不触碰其它 provider；
- Etherscan + Blockscout 时按现有 bounded policy 轮换 key 并 fallback；
- continuation cursor pin 到 provider configuration；
- credentials/proxy/URL 不进入错误、日志或 cursor。

## Package 4：API-only composition

修改 `src/services/ApiChainService.ts`，让继承 Etherscan-compatible contract 的
Blockscout 参与 timestamp lookup、explicit historical balances 和 holdings；
只有 Moralis 的 transaction-context contract 继续保持不变。

验收：`client.chain.getLatestBlockNumber()`、`getBlockNumberByTimestamp()` 和
`client.token.getErc20BalancesAtBlock()` 在 only-Blockscout 配置下返回统一 provider
字段；没有 capability 的 Blockscout endpoint 不得被静默当成 receipt/RPC fallback。

## Package 5：测试和公开文档

新增 `tests/unit/blockscout-adapter.test.ts`，必要时补充 `domain.test.ts`、
`client.test.ts` 和 package smoke。更新：

- `docs/BLOCKSCOUT_PROVIDER/UPGRADE.md`；
- `docs/BLOCKSCOUT_PROVIDER/TASK_BREAKDOWN.md`；
- `docs/BLOCKSCOUT_PROVIDER/AI_IMPLEMENTATION_PROMPT.md`；
- `docs/SPEC.md`、`docs/ARCHITECTURE.md`、`docs/INTEGRATIONS.md`、
  `docs/DECISIONS.md`、`docs/NEXT_SESSION.md`、`README.md`。

按以下顺序执行并记录结果：

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:package
pnpm check
```

## Package 6：可选 live smoke

只在维护者显式提供 endpoint/key 后执行，最多一个或两个实例、一个小地址集合、
有明确 timeout。输出只允许 provider name、chain ID、条目数量和安全 error code。
live 失败不能改变默认离线测试，也不能把未经核对的网络域名加入 built-in route。
