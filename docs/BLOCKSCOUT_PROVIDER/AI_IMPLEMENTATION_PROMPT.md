# Blockscout Provider Implementation Prompt

将下面的 prompt 连同仓库访问权限交给 Claude Sonnet 5 或 ChatGPT Terra：

```text
你是 /home/sean/git/EVM-Data-SDK 的实现工程师。任务是把
docs/BLOCKSCOUT_PROVIDER/UPGRADE.md 规定的 Blockscout provider 完整接入 SDK，
并按 TASK_BREAKDOWN.md 的顺序完成测试和文档交接。

开始前必须完整阅读：
  Agent.md
  docs/SPEC.md
  docs/ARCHITECTURE.md
  docs/BUILD.md
  docs/INTEGRATIONS.md
  docs/DECISIONS.md
  docs/NEXT_SESSION.md
  docs/BLOCKSCOUT_PROVIDER/UPGRADE.md
  docs/BLOCKSCOUT_PROVIDER/TASK_BREAKDOWN.md

第一步只做 Context Discovery 和 Architecture Design，报告现有 provider、
ProviderRouter、RequestExecutor、CredentialPool、ApiChainService、ChainRegistry
的边界，列出准确的改动文件、外部 API 证据、风险和测试 seam。遵守 Agent.md：
没有 owner approval 不要安装依赖或编辑 src；本任务若已获实现授权，再继续执行。

目标 public configuration：
  providers: [{ kind: "blockscout", apiKeys: ["..."],
                baseUrl?: "https://<instance>/api" }]

目标 public behavior：
  - client.address.getTransactions() 返回 Page<Transaction>
  - client.address.getNativeBalance() 返回 NativeBalance
  - client.token.getErc20Transfers() 返回 Page<Erc20Transfer>
  - block range、timestamp lookup、explicit historical balance/holdings 只在
    实例真正支持 Etherscan-compatible action 时启用
  - 所有 result 的 provider/provenance 是 "blockscout"，结构和 Etherscan 统一

Blockscout 使用 Etherscan-compatible GET /api：module=account 或 block，
action=txlist|balance|tokentx|tokenbalancehistory|addresstokenbalance|
getblocknobytime，apikey 放 query 参数。不要给 Blockscout 强行发送
Etherscan V2 的 chainid；chain support 必须由 chain.routes.blockscout 明确声明，
provider baseUrl 只能覆盖已声明 route 的 URL。不得运行时猜测网络域名，也不得
让一个单链 baseUrl 自动支持所有 chain。

实现约束：
  - provider adapter 只做一次 upstream attempt；重试、key rotation、proxy 和
    provider fallback 必须继续由 RequestExecutor/CredentialPool/RetryPolicy 负责。
  - 复用现有 Etherscan schema/mapper/error 契约时，加入明确的 provider identity
    参数；不能复制另一份数百行 adapter，也不能让 provider-specific 代码跑到 domain。
  - 金额、区块、索引都是十进制字符串；地址/hash 统一 lowercase；缺失字段是 null。
  - 不把 URL、API key、proxy、cursor 或原始 upstream 文本放进异常、日志或 public model。
  - fullData 只允许真正支持该页面语义的 Etherscan/Blockscout；Alchemy/Moralis
    不能被伪装成等价 provider。
  - continuation cursor 必须 pin 到原 provider configuration，不能跨 provider 拼页。
  - 不加新 HTTP client、ethers/viem、cache、background timer 或无限重试。

必须新增/更新：
  src/providers/blockscout/BlockscoutAdapter.ts
  src/providers/etherscan/EtherscanAdapter.ts（仅共享 identity/route seam）
  src/providers/etherscan/etherscanMapper.ts
  src/providers/etherscan/etherscanErrors.ts
  src/domain/chains.ts
  src/domain/configuration.ts
  src/chains/builtinChains.ts
  src/execution/ProviderRouter.ts
  src/services/ApiChainService.ts
  src/client/EvmDataClient.ts
  src/index.ts
  tests/unit/blockscout-adapter.test.ts 以及受影响的 domain/client tests
  docs/BLOCKSCOUT_PROVIDER/* 和仓库权威文档

测试至少覆盖：单独 Blockscout key pool、Etherscan->Blockscout fallback、
多 Blockscout key rotation、baseUrl 和 built-in route、apikey 参数、无 chainid、
transactions/balance/transfers 的统一映射、分页 cursor pin、empty result、
invalid key、plan/rate/network/HTTP error、malformed payload、secret redaction。
所有默认测试离线且不读环境 key。执行顺序：
  pnpm typecheck
  pnpm lint
  pnpm test
  pnpm build
  pnpm test:package
  pnpm check

完成后更新 docs/NEXT_SESSION.md，说明实现状态、验证命令、未验证的 live endpoint
和后续工作。不要 git reset、不要回滚用户改动、不要 push 或重写历史。
```
