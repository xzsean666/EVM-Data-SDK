# 给 gpt-terra 的实现提示词

下面的内容可以直接复制给负责实现的 gpt-terra。它假定模型能访问当前仓库，并把 `docs/PROXY_AND_BLOCK_RANGE_UPGRADE.md` 作为本次升级的唯一产品设计来源。

```text
你是本仓库 EVM-Data-SDK 的实现工程师。请在 /home/sean/git/EVM-Data-SDK 工作，不要凭空重写现有架构。

任务：实现 docs/PROXY_AND_BLOCK_RANGE_UPGRADE.md 中的 v0.3 proposal，包含：
1. sing-box 高级代理：支持 vless:// 和 ss:// URL；只在配置 advancedProxy 且真正需要代理时准备固定版本的 sing-box；支持 linux/darwin/win32 的 x64/arm64；把 sing-box loopback mixed inbound 作为现有 HttpTransport 的本地 HTTP proxy；正确管理子进程、缓存、临时配置、校验和、取消和 close 生命周期。
2. 区块范围 ERC-20 全量查询：新增 getErc20TransfersByBlockRange({ chain, address, startBlock, endBlock, direction?, tokenAddress?, signal? })；公共请求绝对不能出现 pageSize 或 provider cursor；成功时只在整个闭区间扫描完成后返回范围内的全部 Erc20Transfer；内部以重新发起的自适应闭区间窗口覆盖范围，可在 Etherscan、Alchemy、Moralis 之间按窗口轮换；支持双向语义；正确去重和排序；多源结果必须显式暴露 provenance，不能静默合并。

第一步：完整阅读 Agent.md、docs/SPEC.md、docs/ARCHITECTURE.md、docs/BUILD.md、docs/INTEGRATIONS.md、docs/DECISIONS.md、docs/NEXT_SESSION.md 和 docs/PROXY_AND_BLOCK_RANGE_UPGRADE.md。检查当前工作树和测试。先给出 Step 0 Context Discovery 与 Step 1 Architecture Design：列出已有模块、变更文件、依赖、风险、公开类型、错误码、数据流和测试计划。没有 owner 的明确架构批准时，不要编辑 src/，也不要安装依赖。

获得明确批准后，严格按工作包实现，每个工作包完成后运行对应测试并更新 docs/NEXT_SESSION.md；不要同时做未批准的额外重构。建议顺序：

P0 文档/集成决策：确认 sing-box 固定版本、release asset、GitHub digest 校验方式、运行时支持矩阵和 Moralis 的区块范围参数。若官方文档与提案冲突，先更新 docs/INTEGRATIONS.md、docs/DECISIONS.md 和 proposal，再请求批准。

P1 公共领域契约：扩展 ClientConfiguration、错误码、TokenService 方法、Erc20BlockRangeResult 和请求归一化。startBlock/endBlock 是非负 canonical decimal string 且闭区间；address 仍必需；direction 默认 both。成功结果有 chainId/address/range/items/provider/stats；不要把 pageSize、nextCursor、原始 cursor 放进公共请求/结果。

P2 sing-box URL parser/config builder：
- 只接受 scheme 为 vless 或 ss（大小写归一化）；不能用 startsWith("vless:/") 识别。
- VLESS 校验 UUID、host、1..65535 port；首期严格支持提案列出的 tls/reality、tcp/ws/grpc/httpupgrade、sni/fp/pbk/sid/flow/path/host/serviceName/alpn/allowInsecure 组合。未实现组合必须 INVALID_CONFIGURATION，不能猜测。
- SS 安全处理 base64/base64url 的 method:password@host:port；首期明确拒绝 SIP002 plugin。
- 原始 URL、UUID、密码、公钥、完整 sing-box config 不能进入 error message、telemetry、cursor、snapshot 或测试输出。
- 只生成 localhost mixed inbound 和由解析 URL 生成的 outbound/urltest；不得接受任意 JSON、TUN、系统路由或 0.0.0.0 监听。

P3 binary/runtime lifecycle：
- 默认 lazy；没有 advancedProxy 时不得下载、spawn、网络探测或定时器。不要使用 npm postinstall 无条件联网。
- 版本必须固定，不能自动跟随 latest。默认 release host 使用官方 GitHub；支持显式 binaryPath 和测试用 mirror/checksum manifest。
- 映射 process.platform/process.arch：linux/darwin/win32 × x64/arm64，x64 -> amd64，arm64 -> arm64；linux/darwin tar.gz，Windows zip。下载后先验证官方 SHA-256 digest，再安全解压（阻止路径穿越），原子安装，Unix chmod 0700；失败删除临时文件。
- runtime 用可注入 child-process/fs/net seam 测试 spawn、ready probe、early exit、startup timeout、stderr redaction、AbortSignal、SIGTERM/SIGKILL 有界关闭和幂等 close。不要在默认测试启动真实 sing-box 或访问 GitHub。
- 需要异步初始化时提供 client.initialize()；eager 必须等待它，lazy 首次 acquire 也必须 await。advancedProxy 不可用且 requestPolicy.allowDirect=false 时返回 PROXY_ERROR/PROXY_NOT_READY，绝不静默直连。
- 修改 ProxyPool/RequestExecutor 时保持现有 HTTP(S) proxy、direct policy、cooldown、retry 和 price routeMode 语义；执行层只看到本地 HttpProxy，不解析 VLESS/SS。

P4 provider-local block-range adapters/scanner：
- 先实现 Etherscan V2 account/tokentx 的 startblock/endblock + sort asc + 内部 offset 上限；禁止 legacy explorer API。
- Alchemy ERC-20 使用 fromAddress/toAddress 两个固定流、fromBlock/toBlock、maxCount 上限和 pageKey；self-transfer 只归 outgoing；合并后按 identity 去重。
- Moralis 与 Etherscan、Alchemy 一样是范围候选；先用官方资料和 fixture 锁定 from_block/to_block 的闭区间和终止语义，再声明 supportsBlockRange。
- 新增 BlockRangeScanner（职责命名，不要 generic utils/base/manager）：维护待覆盖闭区间和 coverage ledger，不维护跨窗口 provider cursor/page state；用 BigInt 比较；响应不能证明窗口终止时，将该窗口拆为两个更小的不重叠闭区间并重新查询；单区块依次尝试三个 provider。每一步必须有窗口完成或严格拆分的进度证明和最大窗口数，失败为 BLOCK_RANGE_STALLED，不能死循环。
- 每个窗口允许现有 bounded provider fallback，并可由不同 provider 完成；只有 completed windows 构成输入范围的完整无重叠分割时才成功。失败抛 BLOCK_RANGE_INCOMPLETE（脱敏未完成窗口、已完成窗口数、已尝试 provider），不能把部分数组标成 complete。
- identity 优先 (chainId, transactionHash, logIndex)；logIndex 缺失时使用 provider 明确保证的唯一键，绝不能伪造 logIndex。输出排序 blockNumber、transactionIndex、logIndex、transactionHash 升序。
- maxRangeRecords 只能作为显式安全上限；达到上限抛 RANGE_RESULT_TOO_LARGE，不得截断后返回成功。

P5 composition/public exports：在 EvmDataClient 中显式组合 runtime、proxy pool、scanner 和 services；导出提案要求的公共类型/错误，不导出内部 provider payload 或运行时细节；close 必须释放 sing-box 子进程和临时文件且不影响无高级代理用户。

测试要求：
- 默认 pnpm test 不联网、不读 .env.key、不启动 sing-box；所有 HTTP/provider/runtime 行为使用 fake transport、fake clock、fake child process、fake downloader。
- 覆盖 URL parser、VLESS TLS/Reality/WS/gRPC、SS base64/base64url、非法参数和秘密脱敏；binary platform mapping、cache、digest mismatch、archive traversal、startup/close/abort。
- 覆盖范围输入、空范围、恰好 provider 上限、窗口拆分/重新查询、单区块超过三个 provider 上限、Alchemy 双流/self-transfer/pageKey、Moralis 范围参数、duplicate、排序、stalled progress、窗口级 provider 轮换与 coverage ledger、incomplete、maxRangeRecords、timeout/abort/proxy failure。
- 证明没有 advancedProxy 时没有 import-time side effect；allowDirect=false 时不能绕过配置；日志/异常/cursor/snapshot/tarball 没有 API key、proxy credential、VLESS/SS URL、密码、UUID 或下载 token。
- 运行 pnpm typecheck、pnpm lint、pnpm test、pnpm build、pnpm test:package；需要时增加 opt-in live smoke，但绝不打印 secrets/URLs/cursors/items。更新 README、SPEC、ARCHITECTURE、INTEGRATIONS、DECISIONS、NEXT_SESSION，使 proposal/implementation status 一致。

代码风格和仓库约束：
- 遵守 Agent.md：provider-local schema/mapper/error，中央执行层负责 retry/credential/proxy，公共 on-chain 数量使用十进制字符串，严格 TypeScript/Zod，禁止隐藏环境读取、全局可变状态、缓存、后台 SDK health timer、generic utils/base/manager。
- 使用 apply_patch 编辑文件；不要 git reset --hard、不要删除用户改动、不要伪造 git identity、不要 push。
- 每个工作包先报告要改的文件、原因和预期影响；完成后报告测试结果、剩余风险和下一步。若发现官方 API 或 sing-box 当前行为与提案不符，停止实现并先更新文档请求批准。
```

## 使用说明

把提示词交给 gpt-terra 时，建议同时附上本仓库路径和“先完成 Step 0/1，等待架构批准”的要求。这样它会先审计现有 `ProxyPool`、`RequestExecutor`、配置 schema 和 provider adapter，而不会把异步 sing-box 生命周期仓促塞进同步的 `acquire()`。
