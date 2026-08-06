# Proxy 与区块范围全量查询升级提案

版本：0.3.0 proposal  
状态：架构于 2026-08-06 获 owner 批准；实现进行中  
最后更新：2026-08-06  
基于：v0.2.0 EVM Data SDK 架构

## 1. 目标与边界

本提案包含两个相互独立、可以分开交付的能力：

1. 新增 sing-box 代理运行时，接收 `vless://` 或 `ss://` URL，在需要使用高级代理时自动准备对应平台的 sing-box 二进制，并向现有 Axios 传输层提供本机 HTTP CONNECT 入口。
2. 新增按区块范围读取 ERC-20 转账的操作。调用方只提交链、地址和闭区间区块范围，不提交 `pageSize`，SDK 在内部以多个重新发起的、不重叠的闭区间窗口覆盖整个范围；窗口可在 Etherscan、Alchemy 和 Moralis 之间轮换，但每个已完成窗口都有明确 provenance。

这不是“绕过配额”或“保证绕过网络封锁”的承诺。代理只改变传输路径，API key、账户计划、提供商语义和服务条款仍然有效；调用方必须拥有代理节点和数据访问的合法授权。

v0.2 的三个分页操作、HTTP(S) 代理配置、`allowDirect`、提供商固定 cursor 和价格查询必须保持兼容。新能力在架构批准之前只能作为 proposal，不能直接进入默认行为。

## 2. 公开 API 草案

### 2.1 高级代理配置

现有的 `proxies: [{ url: "http://..." }]` 继续表示 HTTP(S) 代理。新增独立的 `advancedProxy` 字段，避免把 `vless://` 或 `ss://` 错误地传给 Axios：

```ts
const client = new EvmDataClient({
  providers: [
    { kind: "etherscan", apiKeys: [process.env.ETHERSCAN_API_KEY!] },
    { kind: "moralis", apiKeys: [process.env.MORALIS_API_KEY!] },
  ],
  requestPolicy: {
    // false 表示没有可用的 HTTP(S) 或 sing-box 本地入口时不能直连。
    allowDirect: false,
  },
  advancedProxy: {
    kind: "sing-box",
    urls: [
      process.env.PROXY_VLESS_URL!,
      process.env.PROXY_SS_URL!,
    ],
    singBox: {
      version: "1.13.16",
      downloadMode: "lazy",
      startupTimeoutMs: 10_000,
    },
  },
});
```

建议的类型如下；命名可以在实现阶段微调，但语义不能改变：

```ts
interface SingBoxProxyConfiguration {
  readonly kind: "sing-box";
  readonly urls: readonly string[]; // 至少一个 vless:// 或 ss:// URL
  readonly singBox?: {
    /** 必须是固定版本；禁止默认跟随 latest。 */
    readonly version?: string;
    /** 已存在且通过校验的 sing-box 可执行文件。 */
    readonly binaryPath?: string;
    /** 二进制缓存目录；未提供时使用平台缓存目录。 */
    readonly cacheDir?: string;
    /** lazy 只在首次需要代理时准备；eager 由 client.initialize() 触发。 */
    readonly downloadMode?: "lazy" | "eager";
    readonly startupTimeoutMs?: number;
  };
}
```

`advancedProxy` 未配置时不得下载、解压、启动或探测 sing-box。默认 `lazy`，因此仅构造 client 也不会发生网络或子进程副作用。若选择 `eager`，实现应增加异步的 `client.initialize()`；在初始化完成前调用数据方法必须得到明确的 `PROXY_NOT_READY`，不能偷偷直连。

`requestPolicy.allowDirect` 继续是总开关：

- `true`：按现有规则在显式 HTTP(S)、sing-box 本地入口和 direct 路由之间调度。
- `false`：只允许显式 HTTP(S) 或已经准备好的 sing-box 本地入口；所有入口不可用时返回 `PROXY_ERROR`。

价格路径的 `price.routeMode: "proxy-only"` 也必须能够使用 sing-box 产生的本地入口；`direct` 的默认语义不变。

### 2.2 按区块范围读取 ERC-20 转账

新增一个不暴露分页参数的操作，建议名称为 `getErc20TransfersByBlockRange`：

```ts
const result = await client.token.getErc20TransfersByBlockRange({
  chain: "ethereum",
  address: "0x0000000000000000000000000000000000000000",
  startBlock: "19000000",
  endBlock: "19010000",
  direction: "both",       // 默认值；incoming/outgoing 仍然可选
  tokenAddress: undefined,  // 可选的一个 ERC-20 合约
});
```

地址仍然是必需的：这是“某个用户在区块范围内的 ERC-20 数据”，不是全链事件索引。若将来需要不带地址的全链 Transfer 扫描，应单独定义日志扫描 API、吞吐限制和流式返回，不能把本操作扩大成全链抓取。

如果业务层已经绑定了一个固定用户地址，可以在业务层再包一层只接收
`startBlock/endBlock` 的 helper；SDK 核心仍保留 `address` 字段，避免把
“用户数据”和“全链数据”混成同一个昂贵且语义不明确的请求。

建议的返回模型：

```ts
interface BlockRange {
  readonly startBlock: string; // canonical decimal, inclusive
  readonly endBlock: string;   // canonical decimal, inclusive
}

interface Erc20BlockRangeResult {
  readonly chainId: number;
  readonly address: string;
  readonly range: BlockRange;
  readonly direction: "incoming" | "outgoing" | "both";
  readonly items: readonly Erc20Transfer[];
  /** 覆盖本次范围的 provider，按首次完成窗口的顺序去重。 */
  readonly providers: readonly ProviderName[];
  readonly stats: {
    readonly windows: number;
    readonly upstreamRequests: number;
    readonly duplicateItemsRemoved: number;
    /** 每个 provider 实际完成的窗口数；不能把多源结果伪装成单一来源。 */
    readonly providerWindows: Readonly<Record<string, number>>;
  };
}
```

成功结果必须包含范围内所有满足过滤条件的记录，按 `blockNumber`、`transactionIndex`、`logIndex`、`transactionHash` 的稳定升序排列。公共请求和结果没有 `pageSize`、`nextCursor` 或 provider 原始 cursor；扫描器也不把 cursor/page state 跨窗口保存。若多个 provider 完成了不同窗口，结果必须通过 `providers`、`providerWindows` 和每个 `Erc20Transfer.provider` 明确显示来源。数量、区块号和索引仍然使用十进制字符串。

为防止无界内存，配置可以提供 `maxRangeRecords`。到达限制时不能静默截断，必须抛出 `RANGE_RESULT_TOO_LARGE`，并报告安全的进度信息；需要真正无限量消费时应在后续里程碑增加 async iterator，而不是返回一个假装完整的数组。

## 3. sing-box 设计

### 3.1 组件职责

新增模块应按职责拆分，不要把它放进 `ProxyPool` 或 Axios 文件中：

| 模块 | 职责 |
| --- | --- |
| `src/proxy/SingBoxUrlParser.ts` | 识别并校验 `vless://`、`ss://`，转换为内部无秘密的参数对象 |
| `src/proxy/SingBoxConfigBuilder.ts` | 将内部参数转换为严格的 sing-box JSON；只生成本机 mixed inbound 和受控 outbound |
| `src/proxy/SingBoxBinaryManager.ts` | 平台/架构映射、固定版本下载、SHA-256 校验、原子缓存和权限 |
| `src/proxy/SingBoxRuntime.ts` | 创建临时配置、spawn、就绪探测、stderr 分类、优雅停止和超时清理 |
| `src/proxy/SingBoxProxyManager.ts` | 将一个 URL 集合的运行时暴露为本地 HTTP 代理 lease，并与 client 生命周期绑定 |
| `src/execution/ProxyPool.ts` | 只负责 route lease、冷却和结果报告；不解析协议、不下载二进制 |

`RequestExecutor` 和 `PriceRequestExecutor` 只能看到一个经过 `HttpTransport` 验证的本地 HTTP proxy，不应知道 VLESS、SS、sing-box 配置或进程细节。

### 3.2 URL 解析

解析必须使用 URL scheme，而不是只检查字符串前缀（例如不能依赖 `vless:/`）：

- scheme 大小写归一化后只能是 `vless` 或 `ss`；其他 scheme 在 client 构造时失败。
- VLESS 至少要求合法 UUID、主机名、1–65535 端口。首期支持 `security=none|tls|reality`、`type=tcp|ws|grpc|httpupgrade`，以及这些传输需要的 `sni`、`fp`、`pbk`、`sid`、`flow`、`path`、`host`、`serviceName`、`alpn` 和 `allowInsecure` 参数。缺少必需参数或遇到未实现的组合必须返回 `INVALID_CONFIGURATION`，不能猜测。
- SS 必须安全解码标准 base64/base64url 形式的 `method:password@host:port`，并校验 cipher、密码、主机和端口。首期不实现 SIP002 plugin；带 plugin 的 URL 应明确拒绝。
- URL fragment 只作为可选显示名称，不进入日志或错误。用户名、密码、UUID、Reality 公钥等都视为秘密。
- 解析结果要做不可变结构化表示；原始 URL 不得进入 telemetry、cursor、异常 message 或 snapshot。

### 3.3 运行时配置与生命周期

每个 `advancedProxy` 配置创建一个 sing-box 进程，URL 集合转换为多个 outbounds，并由一个 `urltest`/等价受控选择组选择可用节点。这样调用方只需管理一个本地 HTTP 入口；sing-box 内部负责节点健康选择。SDK 不启动自己的后台 health timer。

生成配置的硬性约束：

1. inbound 只监听 `127.0.0.1`（Windows 同样不能绑定 `0.0.0.0`），使用 `mixed` 类型以兼容 Axios HTTP CONNECT。
2. 使用动态未占用端口；端口冲突时有界重试。就绪判定至少包括子进程仍存活和本地 TCP/HTTP CONNECT 探测成功。
3. outbound 只来自已解析的 URL；不得接受调用方任意注入的 sing-box JSON、TUN、system route 或 LAN 监听配置。
4. 临时配置文件使用 `0600`（Windows 使用等价的仅当前用户 ACL），关闭时删除；stderr 只保留脱敏后的错误摘要。
5. `close()` 必须幂等：先停止接收新 lease，等待/取消 in-flight 请求，向进程发送终止信号，限定时间后强制杀死，并删除临时文件。构造 client 不得泄漏进程或 timer。
6. 下载、解压、启动和就绪探测均要支持调用方 `AbortSignal` 或总超时；任何失败都映射到稳定的 `SING_BOX_*`/`PROXY_ERROR` 错误码。

### 3.4 二进制管理

推荐“首次真正使用时下载”，而不是 npm `postinstall`：安装阶段联网会影响离线构建、锁文件复现和供应链审计。可以保留显式 `client.initialize()` 作为 eager 入口。

二进制策略：

- 版本必须固定，例如 `1.13.16`，禁止每次启动跟随 GitHub `latest`。
- 默认下载源为 sing-box 官方 GitHub release；实现允许传入受信任的镜像和校验清单用于企业网络，但不能把任意 URL 当作可执行文件来源。
- `process.platform`/`process.arch` 只支持 `linux|darwin|win32` 的 `x64|arm64`。映射为 sing-box release 的 `amd64|arm64`；Linux/macOS 使用 `tar.gz`，Windows 使用 `zip`。例如 `sing-box-1.13.16-darwin-arm64.tar.gz`、`sing-box-1.13.16-linux-amd64.tar.gz`、`sing-box-1.13.16-windows-amd64.zip`。
- 下载到窄范围临时文件，校验官方 release API 提供的 SHA-256 digest（或受信任清单），再原子 rename 到 `cacheDir/<version>/<platform>-<arch>/`。校验失败、归档路径穿越、找不到唯一可执行文件都必须删除临时数据并失败。
- Unix 可执行文件设置 `0700`；Windows 使用当前用户可执行权限。缓存命中时仍检查文件存在、权限和可执行格式。
- 不把二进制放入 npm tarball，也不在日志中输出下载 URL 中可能包含的 token/query。

默认版本和 release 资产名必须在 `docs/INTEGRATIONS.md` 中记录，并在实现时用 fixture 测试，不依赖实时 GitHub `latest`。

### 3.5 错误和可观测性

建议新增稳定错误码：

```text
SING_BOX_PLATFORM_UNSUPPORTED
SING_BOX_VERSION_INVALID
SING_BOX_DOWNLOAD_FAILED
SING_BOX_CHECKSUM_MISMATCH
SING_BOX_START_FAILED
SING_BOX_START_TIMEOUT
SING_BOX_EXITED
SING_BOX_CONFIG_INVALID
PROXY_NOT_READY
```

对外 message 只能包含错误类别、平台、架构、版本和重试建议；不得包含原始 VLESS/SS URL、密码、UUID、完整配置、缓存绝对路径中的敏感部分或子进程原始命令行。telemetry 只报告 `proxyKind: "sing-box"`、runtime id 的不可逆短 hash、耗时和错误码。

## 4. 区块范围扫描设计

### 4.1 语义和 provider 能力

本操作的语义是：返回地址作为 `from` 或 `to`（取决于 `direction`）的已确认 ERC-20 `Transfer` 事件，且 `startBlock <= blockNumber <= endBlock`。它不返回余额、approval、NFT、internal transfer 或无法映射为 `Erc20Transfer` 的事件。

适配器必须声明 `supportsBlockRange`，并在能力检查阶段验证链、方向、token 过滤和范围大小，不符合语义的 provider 不能被尝试。建议的首期能力：

| Provider | 首期用途 | 内部单次上限 |
| --- | --- | ---: |
| Etherscan V2 `account/tokentx` | 地址 ERC-20，from/to 双向，`startblock/endblock` | `offset=10,000` |
| Alchemy Transfers API | ERC-20，`fromAddress` 与 `toAddress` 两条流合并 | `maxCount=1,000`/流 |
| Moralis ERC-20 transfers | 地址 ERC-20，使用 `from_block/to_block`；P0 必须以官方资料和 fixture 锁定边界/终止语义 | `limit` 取适配器声明上限 |

三个 provider 都是本操作的候选范围来源，但能力判断仍须逐个验证链、方向、token 过滤、闭区间边界和终止信号；不满足这些精确语义的 provider 不能被尝试。

### 4.2 自适应窗口算法

扫描器维护一个待覆盖的闭区间队列和一个已完成窗口 ledger；所有区块比较使用 `BigInt`，公开模型仍是十进制字符串。它不携带 Etherscan page、Alchemy `pageKey` 或 Moralis cursor 到下一次窗口请求。

```text
pending = [[startBlock, endBlock]]
while pending is not empty:
  [windowStart, windowEnd] = pending.pop()
  按 capability-aware priority 逐个尝试可用 provider，
  每次都用 provider 的内部最大页容量、sort=asc 从该窗口重新查询

  若某 provider 明确证明该窗口已经终止：
    收集该窗口的映射记录，记录 provider 和闭区间覆盖，继续下一个待覆盖窗口
  若响应表示该窗口仍有更多记录：
    不携带 cursor/page state；丢弃这次不完整窗口的记录
    若 windowStart < windowEnd：
      在 BigInt 中点拆为 [windowStart, midpoint] 与 [midpoint + 1, windowEnd]
      将两个新的不重叠闭区间加入 pending，重新从新的区块范围查询
    否则：
      依次尝试其余 provider 对同一个单区块窗口的独立范围查询
      若全部仍不能证明终止，失败为 BLOCK_RANGE_STALLED
```

每一步都必须证明进度：一个窗口被完整覆盖，或该窗口被拆成两个跨度严格更小、无重叠且并集相同的新窗口。不得用 `lastBlock + 1` 直接跳过一个满页的末尾区块，否则该区块内未返回的转账可能丢失。连续返回无法证明终止的响应、无效的终止信号、无效区块边界、超过最大窗口数，或所有 provider 都无法完成同一个密集单区块时，必须抛出 `BLOCK_RANGE_STALLED`，不能死循环。

不同 provider 的终止信号和单窗口请求细节由 provider-local adapter 负责；扫描器不拼接 Etherscan page、Alchemy pageKey 或 Moralis cursor。Alchemy `both` 方向仍然是两个固定过滤的流，self-transfer 只从 outgoing 流发出。扫描器优先按 `(chainId, transactionHash, logIndex)` 去重；`logIndex` 缺失时只能使用该 provider 明确保证的唯一键，且该 fallback identity 必须包含 provider，绝不凭空制造 log index 或把不同 provider 的未知 identity 误判为同一条记录。

### 4.3 provider 选择、fallback 和完整性

- 每个待覆盖窗口都按现有 capability-aware priority 选择 provider；失败或无法完成该窗口时，可以在同一窗口内尝试下一个 eligible provider。
- 成功后的下一个请求必须是新的、由 coverage ledger 产生的闭区间查询；它不复用前一个 provider 的 cursor/page state。不同窗口可以由不同 provider 完成。
- 已完成窗口必须构成原始 `[startBlock, endBlock]` 的无重叠完整分割。扫描器在返回成功前验证该分割，不允许有空洞或超出请求边界。
- 多 provider 结果不是静默拼接：每个 item 保留其 provider，结果列出所有 provider 和完成窗口计数。若一个窗口不能由任何 candidate 完成，抛出 `BLOCK_RANGE_INCOMPLETE`，其中包含脱敏的未完成窗口、已完成窗口数和已尝试 provider；绝不返回假装 complete 的部分数组。

因此“多个 API 配合”是以同一份闭区间 coverage ledger 驱动的窗口级调度：每个窗口只在一个 provider 明确证明完整后才提交记录，窗口之间可轮换 Etherscan、Alchemy 和 Moralis。它不是把任意 provider 的半页或 cursor 状态拼在一起。

### 4.4 结果、顺序和内存

结果只在整个范围完成后 resolve。统一排序键为：

1. `blockNumber` 数值升序；
2. `transactionIndex`（缺失排在末尾）；
3. `logIndex`（缺失排在末尾）；
4. `transactionHash` 字典序。

重复 identity 只保留一次，并统计 `duplicateItemsRemoved`。只有 provider 明确证明一个窗口终止时，该窗口的记录才可进入结果；不得仅凭页长猜测完成。窗口溢出必须拆分并重新查询，直到 coverage ledger 覆盖整个范围或以受限错误结束。

## 5. 错误、取消和资源安全

新增范围错误建议：

```text
INVALID_BLOCK_RANGE
BLOCK_RANGE_UNSUPPORTED
BLOCK_RANGE_INCOMPLETE
BLOCK_RANGE_STALLED
RANGE_RESULT_TOO_LARGE
```

`startBlock`、`endBlock` 必须是非负 canonical decimal string，且 `startBlock <= endBlock`。调用方取消、总超时、API 限制、代理失败沿用现有错误模型；如果 sing-box 进程在请求中退出，应先清理 lease，再按一次 bounded retry policy 决定是否重启，不能无限拉起进程。

所有新循环都必须有：最大尝试数、总超时、AbortSignal、最大待处理/已完成窗口数、单密集区块安全上限。临时配置、二进制临时文件、child process、socket lease 在成功、异常、取消和 `close()` 路径都要清理。

## 6. 测试和验收标准

### 6.1 sing-box

- URL parser 覆盖大小写 scheme、VLESS TLS/Reality/WS/gRPC、SS base64/base64url、非法 UUID/端口、缺字段、plugin 拒绝和秘密脱敏。
- binary manager 覆盖 linux/darwin/windows × x64/arm64 映射、未支持平台、缓存命中、下载中断、SHA-256 错误、归档路径穿越、原子安装和权限。
- runtime 使用假的 executable/child-process seam，覆盖 startup timeout、提前退出、ready probe、stderr 脱敏、重复 `close()` 和取消；默认单元测试不得启动真实 sing-box 或访问 GitHub。
- 配置断言 inbound 只能是 loopback mixed，outbound 只能来自解析 URL，配置文件权限为用户私有。
- client 没有 `advancedProxy` 时不产生网络、二进制或子进程副作用；`allowDirect:false` 时无可用高级代理必须失败而非直连。

### 6.2 区块范围

- 输入验证：地址、链、十进制区块、反向范围、token、取消和最大结果数。
- Etherscan fixture：小范围、恰好 10,000 条、跨窗口边界、单区块超过上限、空范围、provider timeout 和逻辑错误。
- Alchemy fixture：from/to 两流、self-transfer、不同 pageKey 终止、窗口拆分后的重新查询、去重和排序。
- Moralis fixture：`from_block/to_block` 闭区间、终止信号和范围能力；三个 provider 都可作为不同窗口的 candidate。
- 模拟窗口溢出、无效终止信号、单区块被三个 provider 都截断、以及最大窗口数，测试 `BLOCK_RANGE_STALLED` 不会死循环且不依赖 cursor/page state 推进。
- 证明 public request 类型没有 `pageSize`，一次成功调用以无重叠 coverage ledger 覆盖闭区间内所有 fixture 记录；provider 在窗口间切换时结果显式列出来源；失败不返回 `complete` 结果，并能报告未完成窗口。
- 测试重复 records、缺失 logIndex、最大结果数、AbortSignal、总超时、proxy failure、credential rotation 和 secret redaction。

### 6.3 端到端和发布

- `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build`、`pnpm test:package` 全部通过。
- 增加 opt-in live smoke：仅使用应用层内存读取的 `.env.key`，不打印 URL、key、cursor、配置或 record 内容；默认测试仍然无网络。
- npm tarball 不包含 sing-box 二进制、临时配置、`.env*`、fixture secrets 或下载缓存。
- 更新 README、SPEC、ARCHITECTURE、INTEGRATIONS、DECISIONS、NEXT_SESSION，并在架构批准前明确标为 proposal。

## 7. 非目标

- 不支持浏览器、TUN、系统全局代理、透明代理、UDP 或任意 sing-box JSON 注入。
- 不在 npm `postinstall` 中无条件联网下载可执行文件。
- 不读取 SDK 内部的 `.env.key`；环境变量和文件解析属于应用/测试脚本。
- 不用 VLESS/SS 代理承诺绕过 provider plan、IP 配额或服务商限制。
- 不把 Alchemy asset transfer 映射成完整 normal transaction。
- 不把不同 provider 的半个范围直接合并成一个无 provenance 的数组。
- 不在首期为全链 ERC-20 日志扫描、无限内存数组或缓存/数据库定义隐含语义。

## 8. 参考资料

- sing-box 配置总览：<https://sing-box.sagernet.org/configuration/>
- mixed inbound：<https://sing-box.sagernet.org/configuration/inbound/mixed/>
- VLESS outbound：<https://sing-box.sagernet.org/configuration/outbound/vless/>
- Shadowsocks outbound：<https://sing-box.sagernet.org/configuration/outbound/shadowsocks/>
- sing-box 官方 releases：<https://github.com/SagerNet/sing-box/releases>
- GitHub releases API（用于固定版本资产与 digest）：<https://api.github.com/repos/SagerNet/sing-box/releases>
- Etherscan V2 ERC-20 transfers：<https://docs.etherscan.io/api-reference/endpoint/tokentx>
- Alchemy Transfers API：<https://www.alchemy.com/docs/data/transfers-api/transfers-endpoints/alchemy-get-asset-transfers>
- Moralis ERC-20 transfers：<https://docs.moralis.com/data-api/evm/wallet/token-transfers>
