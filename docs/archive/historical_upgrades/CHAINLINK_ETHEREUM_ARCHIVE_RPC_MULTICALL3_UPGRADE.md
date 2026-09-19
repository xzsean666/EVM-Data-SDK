# Chainlink Historical Prices via Ethereum Archive RPC and Multicall3 Upgrade

Version: v0.4 proposal

Status: Architecture proposal; source implementation requires owner approval

Project ID: `chainlink-ethereum-archive-rpc-multicall3`

Last updated: 2026-08-07

## 1. Goal

Add an opt-in Chainlink oracle snapshot feature to EVM Data SDK. The caller
provides one Ethereum Mainnet block number and no token selector. The SDK reads
every eligible built-in Chainlink token/USD feed at that exact block and
returns the price that the Chainlink feed proxy considered latest at that
block.

```ts
const client = new EvmDataClient({
  chainlink: {
    enabled: true,
    useBuiltinEthereumArchiveRpcs: true,
  },
});

await client.initialize();

const snapshot = await client.chainlink.getTokenPricesAtBlock({
  blockNumber: "18000000",
  signal,
});
```

The implementation uses standard Ethereum JSON-RPC `eth_call` with an exact
hexadecimal `blockTag`. It calls Chainlink `latestRoundData()` through
Multicall3 so many feed contracts can be read with a bounded number of RPC
requests.

This is a Chainlink oracle-state snapshot, not a market candle, trade price,
TWAP, or cross-provider consensus. It must not be merged into
`getPriceHistory()` without preserving that semantic difference.

## 2. Scope and Definitions

### 2.1 Meaning of “all supported tokens”

For this upgrade, “all” means every enabled entry in the versioned built-in
Ethereum Mainnet Chainlink feed manifest that satisfies all of these rules:

- the official Chainlink network is Ethereum Mainnet, EIP-155 chain ID `1`;
- the feed has a non-empty proxy address implementing `AggregatorV3Interface`;
- asset class/feed type is Crypto;
- product type is Price and product subtype is Reference;
- the quote asset is USD;
- the feed is a standard feed, not an SVR or shared-SVR variant;
- it is not hidden, deprecating, calculated, an exchange-rate-only feed, a
  market-cap feed, Proof of Reserve, FX, commodity, equity, or rate feed.

This definition prevents duplicate ETH/USD, BTC/USD, LINK/USD, and stablecoin
entries caused by standard, SVR, and shared-SVR contracts having different
addresses but similar display names. A later milestone may expose explicit
feed categories, but v0.4 must not silently mix them.

“All” is relative to the committed manifest version, not an assertion that the
SDK discovers new feeds at runtime. Runtime feed discovery would make package
behavior nondeterministic and is out of scope.

### 2.2 Historical semantics

At block `B`, `latestRoundData()` returns the most recent round stored by that
feed as of Ethereum state block `B`. Its `updatedAt` can be earlier than the
block timestamp because Chainlink feeds update according to heartbeat and
deviation rules.

The SDK must never:

- call `latest` when the caller supplied a block;
- reinterpret the round as a candle for the block;
- return zero for a missing, reverted, undeployed, or malformed feed;
- use JavaScript `number` for a block, round, answer, or timestamp;
- omit a failed feed without reporting it.

### 2.3 Multicall3 historical lower bound

The canonical Ethereum Mainnet Multicall3 contract is
`0xcA11bde05977b3631167028862bE2a173976CA11`. P0 integration work must verify
and record its Ethereum deployment block from an authoritative explorer/source
before implementation. A Multicall3 request below that deployment block must
fail with `MULTICALL_NOT_DEPLOYED_AT_BLOCK`; it must not call a non-existent
contract or fabricate an empty snapshot.

Supporting Chainlink history older than Multicall3 requires a separately
reviewed Multicall2 or bounded direct-call fallback. It is not silently added
to v0.4.

## 3. Public Product Contract

### 3.1 Chainlink request and result

Recommended public namespace and operation:

```ts
interface ChainlinkTokenPricesAtBlockRequest {
  /** Canonical non-negative base-10 Ethereum block number. */
  readonly blockNumber: string;
  readonly signal?: AbortSignal;
}

interface ChainlinkPriceAtBlock {
  readonly feedId: string;
  readonly asset: {
    readonly symbol: string;
    readonly name: string | null;
  };
  readonly pair: {
    readonly base: string;
    readonly quote: "USD";
  };
  readonly feedAddress: string;
  readonly blockNumber: string;
  /** Exact signed answer converted to a canonical base-10 integer string. */
  readonly rawAnswer: string;
  /** Exact fixed-point decimal string derived from rawAnswer and decimals. */
  readonly price: string;
  readonly decimals: number;
  readonly roundId: string;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly answeredInRound: string;
  readonly ageSeconds: string;
  readonly heartbeatSeconds: string | null;
  readonly isStale: boolean | null;
  readonly provider: "chainlink";
}

type ChainlinkFeedFailureCode =
  | "FEED_NOT_DEPLOYED_AT_BLOCK"
  | "FEED_CALL_REVERTED"
  | "FEED_ROUND_UNAVAILABLE"
  | "FEED_ANSWER_INVALID"
  | "FEED_RESPONSE_INVALID";

interface ChainlinkFeedFailure {
  readonly feedId: string;
  readonly assetSymbol: string;
  readonly feedAddress: string;
  readonly code: ChainlinkFeedFailureCode;
  readonly retryable: false;
  readonly message: string;
}

interface ChainlinkTokenPricesAtBlockResult {
  readonly chainId: 1;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly blockTimestamp: string;
  readonly registryVersion: string;
  /** Stable configured ID only; never expose the selected endpoint URL. */
  readonly rpcEndpointId: string;
  readonly executionMode: "multicall3";
  readonly prices: readonly ChainlinkPriceAtBlock[];
  readonly failures: readonly ChainlinkFeedFailure[];
  readonly summary: {
    readonly configuredFeeds: number;
    readonly requestedFeeds: number;
    readonly succeededFeeds: number;
    readonly failedFeeds: number;
    readonly multicallBatches: number;
    readonly partial: boolean;
  };
}
```

The method is:

```ts
client.chainlink.getTokenPricesAtBlock(
  request: ChainlinkTokenPricesAtBlockRequest,
): Promise<ChainlinkTokenPricesAtBlockResult>;
```

No token argument is accepted. An application that wants one token filters the
returned typed result; the SDK operation always evaluates the complete enabled
manifest.

At least one successful feed resolves a result and reports every feed failure.
If no feed succeeds, reject with `CHAINLINK_PRICE_DATA_UNAVAILABLE`. Invalid
input, unavailable RPCs, caller cancellation, and Multicall deployment-boundary
errors reject directly instead of returning a feed-level partial result.

### 3.2 Reusable public Multicall module

Multicall must not remain private inside one provider adapter. Expose a
provider-neutral, read-only RPC method:

```ts
interface MulticallAtBlockCall {
  readonly id: string;
  readonly target: string;
  readonly callData: string;
  readonly allowFailure?: boolean;
}

interface MulticallAtBlockRequest {
  readonly chain: 1 | "ethereum";
  readonly blockNumber: string;
  readonly calls: readonly MulticallAtBlockCall[];
  readonly signal?: AbortSignal;
}

interface MulticallAtBlockResult {
  readonly chainId: 1;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly rpcEndpointId: string;
  readonly results: readonly {
    readonly id: string;
    readonly success: boolean;
    readonly returnData: string;
  }[];
}

client.rpc.multicallAtBlock(request): Promise<MulticallAtBlockResult>;
```

The module owns call validation, deterministic batching, Multicall3 ABI
encoding/decoding, exact block tags, endpoint pinning, abort, and total bounds.
It does not know Chainlink ABI or token mapping. The Chainlink service builds
calls and decodes `latestRoundData()`/`decimals()` on top of it.

The existing private Multicall3 `aggregate3` codec in
`src/providers/alchemy/AlchemyAdapter.ts` must be extracted into a
responsibility-named pure module and reused. Do not keep two ABI encoders.
Provider-specific error mapping stays in the provider directory.

## 4. Configuration

Recommended additive configuration:

```ts
interface EthereumArchiveRpcEndpointConfiguration {
  /** Unique redaction-safe identifier used in status and telemetry. */
  readonly id: string;
  /** HTTPS JSON-RPC URL. It may contain a caller-owned token and is secret. */
  readonly url: string;
  readonly enabled?: boolean;
}

interface ChainlinkConfiguration {
  readonly enabled?: boolean;
  /** Defaults to true when chainlink.enabled is true. */
  readonly useBuiltinEthereumArchiveRpcs?: boolean;
  /** Appended to built-ins; IDs and normalized URLs must be unique. */
  readonly rpcEndpoints?: readonly EthereumArchiveRpcEndpointConfiguration[];
  readonly healthCheckTimeoutMs?: number;
  readonly attemptTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxCallsPerMulticall?: number;
  readonly maxRpcAttempts?: number;
}
```

Rules:

- Chainlink is opt-in so existing clients do not unexpectedly contact public
  RPC endpoints during `initialize()`.
- A Chainlink-only client configuration is valid.
- At least two enabled RPC endpoints are recommended; one is valid for custom
  deployments but loses failover.
- Public endpoint URLs and custom URLs never appear in errors, observations,
  snapshots, or results. Only the stable `id` may be emitted.
- The SDK does not read RPC URLs, tokens, or keys from environment variables.
- Configuration parsing performs no network request.

## 5. Archive RPC Registry and Direct-Only Boundary

### 5.1 Built-in candidates

The following unauthenticated public candidates successfully answered an
Ethereum historical `eth_call` to Multicall3 at block `18,000,000` during a
live check on 2026-08-07. This is a verification snapshot, not an uptime,
retention, rate-limit, privacy, or terms guarantee.

| Stable ID | Endpoint |
| --- | --- |
| `drpc-public` | `https://eth.drpc.org` |
| `blastapi-public` | `https://eth-mainnet.public.blastapi.io` |
| `mevblocker-public` | `https://rpc.mevblocker.io` |
| `nodies-public` | `https://eth-pokt.nodies.app` |
| `tenderly-public` | `https://mainnet.gateway.tenderly.co` |

These values belong in one responsibility-named file, proposed as
`src/rpc/builtinEthereumArchiveRpcs.ts`. The update procedure belongs in
[`CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md`](./CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md).

### 5.2 RPC requests never use proxies

Every JSON-RPC request introduced by this project is direct-only:

- do not inject `ProxyPool`, `SingBoxProxyManager`, a proxy lease, or
  `requestPolicy.allowDirect` into the Archive RPC modules;
- pass `proxy: null` at the transport boundary so Axios environment proxy
  discovery is disabled;
- do not read `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, or `NO_PROXY`;
- do not fall back to a configured HTTP/VLESS/SS proxy;
- existing indexed REST and market API proxy behavior remains unchanged.

This boundary applies to health probes, block-header reads, Multicall3
`eth_call`, request-time capability checks, and live test helpers for this
project. Reuse only the pure Multicall ABI codec from the Alchemy adapter; do
not reuse its provider credential/proxy request path.

### 5.3 Initialization and health state

`new EvmDataClient()` remains side-effect free. When Chainlink is enabled,
`await client.initialize(signal)` performs one bounded concurrent probe of all
configured Archive RPC endpoints. It can run alongside existing managed-proxy
initialization, but its network requests are direct.

An endpoint is initially eligible only if it passes all checks:

1. `eth_chainId` equals `0x1`.
2. `eth_getBlockByNumber` returns the configured historical probe block and a
   structurally valid hash/timestamp.
3. Historical `eth_call` invokes Multicall3 `getBlockNumber()` at the same
   block and decodes exactly that block number.
4. The response is valid JSON-RPC 2.0 without an error envelope.

The default probe block is `18,000,000`. It proves a useful archive depth but
cannot prove every earlier block. Request-time archive/state-unavailable errors
therefore remain retryable at the endpoint level.

There is no background timer. Health changes only through initialization and
passive real-request outcomes. A caller can explicitly request a later
`client.rpc.refreshArchiveRpcHealth()` if that operation is accepted during
implementation; no automatic interval is allowed.

### 5.4 Random healthy endpoint selection

For one public operation:

1. Snapshot currently healthy endpoints.
2. Create an unbiased random permutation through an injected `RandomSource`.
3. Pin the whole operation to the first endpoint in that permutation.
4. Read the block header and execute every Multicall batch on that endpoint.
5. On a retryable endpoint/network/archive failure, discard all partial batch
   results and restart the whole operation on the next endpoint.
6. Never attempt the same endpoint twice in one operation.

This satisfies random distribution without mixing different RPC observations
inside one result. Randomness is deterministic in tests. `maxRpcAttempts`, the
number of healthy endpoints, `totalTimeoutMs`, and `AbortSignal` jointly bound
the loop.

Read the requested block header before and after the batches. If the hash
changes, discard the result and retry another endpoint as
`RPC_BLOCK_REORG_DETECTED`. The returned `blockHash` is therefore the hash
observed consistently around all calls.

## 6. Chainlink Feed Registry

### 6.1 Static generated manifest

Runtime code uses a committed generated manifest, proposed as:

```text
src/chainlink/ethereumMainnetPriceFeeds.generated.ts
```

Each entry contains at least:

```ts
interface ChainlinkFeedDefinition {
  readonly id: string;              // for example ethereum-mainnet:eth-usd
  readonly chainId: 1;
  readonly proxyAddress: string;
  readonly assetSymbol: string;
  readonly assetName: string | null;
  readonly baseAsset: string;
  readonly quoteAsset: "USD";
  readonly expectedDecimals: number;
  readonly heartbeatSeconds: string | null;
  readonly sourcePath: string;
}
```

Core mapping examples, not the complete manifest:

| Pair | Standard proxy address | Expected decimals |
| --- | --- | ---: |
| ETH/USD | `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419` | 8 |
| BTC/USD | `0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c` | 8 |
| LINK/USD | `0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c` | 8 |
| USDC/USD | `0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6` | 8 |
| USDT/USD | `0x3E7d1eAB13ad0104d2750B8863b489D65364e32D` | 8 |
| DAI/USD | `0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9` | 8 |

The complete list must be generated and reviewed from Chainlink's official
Ethereum feed metadata; do not manually expand this sample table into source.

### 6.2 Update source and policy

The Chainlink documentation repository currently identifies this metadata URL
for Ethereum Mainnet:

```text
https://reference-data-directory.vercel.app/feeds-mainnet.json
```

The updater must be a manual maintainer command, not runtime behavior. Proposed
script and command:

```text
scripts/update-chainlink-ethereum-feeds.mjs
pnpm update:chainlink-feeds
```

The updater validates unknown JSON, applies the exact v0.4 selection rules,
sorts by stable `id`, rejects duplicates and invalid addresses/decimals, and
writes source URL, retrieval time, and source SHA-256 into the generated file.
An AI or maintainer reviews the diff against the official Chainlink address
page before committing it.

## 7. Multicall and ABI Rules

Use `Multicall3.aggregate3((address,bool,bytes)[])`, selector `0x82ad56cb`.
Each Chainlink feed contributes two calls at the same block:

- `latestRoundData()`, selector `0xfeaf968c`;
- `decimals()`, selector `0x313ce567`.

Both use `allowFailure: true` so one undeployed/reverting feed cannot poison
unrelated prices. The outer Multicall call itself must succeed and decode
exactly the requested result count. Batches preserve input order.

`latestRoundData()` decodes exactly:

```text
(uint80 roundId, int256 answer, uint256 startedAt,
 uint256 updatedAt, uint80 answeredInRound)
```

Validation rules:

- decode `int256` with two's-complement semantics;
- require `answer > 0` and `updatedAt > 0`;
- require `startedAt <= updatedAt <= blockTimestamp`;
- treat `answeredInRound < roundId` as invalid historical data;
- require runtime `decimals()` to be an integer from 0 through 255;
- if runtime decimals differ from manifest `expectedDecimals`, fail that feed
  as `FEED_RESPONSE_INVALID` and surface a sanitized maintenance signal;
- format the price without floating-point arithmetic or exponent notation;
- preserve `rawAnswer`, round IDs, and timestamps as decimal strings.

`isStale` compares `blockTimestamp - updatedAt` with the committed heartbeat
when available. Staleness is metadata, not a reason to replace or omit the
historical answer.

## 8. Proposed Modules and Dependency Direction

```text
src/
├── client/EvmDataClient.ts
├── domain/
│   ├── configuration.ts
│   ├── errors.ts
│   ├── rpcModels.ts
│   └── chainlinkModels.ts
├── rpc/
│   ├── ArchiveRpcTransport.ts
│   ├── EthereumArchiveRpcPool.ts
│   ├── EthereumArchiveRpcExecutor.ts
│   ├── EthereumMulticall3Codec.ts
│   ├── RpcService.ts
│   └── builtinEthereumArchiveRpcs.ts
├── chainlink/
│   ├── ChainlinkService.ts
│   ├── ChainlinkRoundDataCodec.ts
│   └── ethereumMainnetPriceFeeds.generated.ts
└── providers/alchemy/AlchemyAdapter.ts

scripts/
└── update-chainlink-ethereum-feeds.mjs
```

| Module | Owns | Must not own |
| --- | --- | --- |
| `ArchiveRpcTransport` | direct JSON-RPC HTTP mechanics and envelope validation | proxy leases, endpoint retry, Chainlink ABI |
| `EthereumArchiveRpcPool` | initialization probes, passive health and random healthy snapshots | HTTP proxy, Chainlink mapping, background timers |
| `EthereumArchiveRpcExecutor` | endpoint pinning, total budget, restart-on-endpoint-failure | ABI decoding, API provider fallback |
| `EthereumMulticall3Codec` | pure aggregate3 ABI encode/decode | network, feed knowledge, retries |
| `RpcService` | public raw Multicall validation and result mapping | Chainlink interpretation |
| `ChainlinkService` | complete manifest query, feed batching, partial success and normalized prices | endpoint URLs, proxy selection |
| generated feed manifest | stable feed identity and reviewed metadata | runtime fetch or health state |

Do not create generic `utils`, `manager`, `base`, or a second HTTP retry stack.
Pure fixed-point and ABI helpers should be named after their exact
responsibility.

## 9. Errors and Observability

Proposed stable operation-level error codes:

```text
ARCHIVE_RPC_UNAVAILABLE
ARCHIVE_RPC_WRONG_CHAIN
ARCHIVE_STATE_UNAVAILABLE
RPC_BLOCK_NOT_FOUND
RPC_BLOCK_REORG_DETECTED
RPC_RESPONSE_INVALID
MULTICALL_NOT_DEPLOYED_AT_BLOCK
MULTICALL_RESPONSE_INVALID
CHAINLINK_PRICE_DATA_UNAVAILABLE
```

Endpoint transport/timeouts can reuse `NETWORK_ERROR`, `REQUEST_TIMEOUT`, and
`REQUEST_ABORTED` when their existing semantics match.

Observations may contain operation, chain ID `1`, endpoint ID, attempt number,
duration, batch count, outcome, and normalized error code. They must not
contain endpoint URL, URL path/query, authorization, raw request/response,
call data, return data, feed answers, block contents, or custom RPC tokens.

## 10. Testing and Acceptance Criteria

### 10.1 Deterministic tests

- Configuration accepts a Chainlink-only client, rejects duplicate endpoint
  IDs/URLs, invalid protocols, empty endpoint sets, and invalid bounds.
- Client construction makes no network call and starts no timer.
- `initialize()` probes enabled endpoints concurrently with a bound and never
  gives Archive RPC requests a proxy, including when HTTP/SingBox proxies and
  `allowDirect: false` are configured for APIs.
- Health probing rejects wrong chain, latest-only/pruned state, malformed
  block headers, wrong Multicall block number, timeout, and JSON-RPC errors.
- Random endpoint selection uses every healthy endpoint over deterministic
  random fixtures, never repeats one endpoint per operation, pins all batches,
  and restarts from the first batch after endpoint failure.
- Multicall codec covers empty/maximum batches, dynamic offsets, allowFailure,
  revert data, malformed offsets/lengths, and exact input-order mapping.
- The public Multicall method validates target/data/id/block and exposes no
  endpoint URL.
- Chainlink codec covers positive `int256`, negative answer, zero timestamps,
  stale rounds, decimal formatting, decimals mismatch, per-feed revert,
  undeployed feed, malformed tuples, partial success, and all failure.
- Feed updater fixtures cover official metadata changes, SVR exclusion,
  non-USD/calculated/deprecating exclusion, duplicates, missing proxy, invalid
  address/decimals, stable sorting, and deterministic generated output.
- A block below the verified Multicall3 deployment fails explicitly without
  an RPC call to Multicall3.
- Block hash change between pre/post reads discards partial results.
- Abort and total timeout stop every active request and bounded retry.
- Logs, errors, snapshots, and packed artifacts contain no RPC URL/token, raw
  call data, raw return data, or feed response.

Default `pnpm test` uses fake transport, fake clock, and fake random only. It
must not contact public RPCs or Chainlink metadata.

### 10.2 Opt-in live tests

An opt-in live probe may test built-in endpoints and a small core feed set. It
must verify `eth_chainId`, historical block header, Multicall3 block number,
and decoded ETH/USD round data without printing URL, calldata, returndata, or
prices. Public endpoint failure skips or reports endpoint status; it does not
make the default test suite flaky.

### 10.3 Release gate

- Update `SPEC.md`, `ARCHITECTURE.md`, `INTEGRATIONS.md`, `DECISIONS.md`,
  `NEXT_SESSION.md`, README, and package exports after owner approval.
- Record authoritative Chainlink, Multicall3, JSON-RPC, and each built-in RPC
  source/terms in `INTEGRATIONS.md` before source implementation.
- Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and
  `pnpm test:package`.
- Inspect the tarball for generated source only; do not include downloaded
  metadata, probe output, endpoint cache, `.env*`, or live fixtures.
- Make focused conventional commits and never push automatically.

## 11. Non-Goals

- No proxy, VLESS, Shadowsocks, environment-proxy, or proxy fallback for the
  Archive RPC path.
- No runtime download of the Chainlink feed directory.
- No token input, fuzzy symbol resolution, contract discovery, or arbitrary
  user-selected Chainlink feed in the v0.4 snapshot method.
- No non-Ethereum chain in the first milestone.
- No Chainlink Data Streams, SVR, MVR bundles, Proof of Reserve, sequencer
  uptime, FX, commodity, equity, rate, calculated, or market-cap feeds.
- No signing, transaction broadcasting, private key, event indexing, cache,
  database, websocket, or background health timer.
- No replacement of the existing API-only backend synchronization truth. This
  is an explicit optional oracle-read feature and requires a new ADR exception
  to the current API-only boundary.

## 12. Official References to Verify in P0

- Chainlink Price Feed addresses:
  <https://docs.chain.link/data-feeds/price-feeds/addresses>
- Chainlink `AggregatorV3Interface` API:
  <https://docs.chain.link/data-feeds/api-reference>
- Chainlink documentation network metadata source:
  <https://github.com/smartcontractkit/documentation/blob/main/src/features/data/chains.ts>
- Ethereum Mainnet feed metadata currently referenced by that source:
  <https://reference-data-directory.vercel.app/feeds-mainnet.json>
- Multicall3 repository and deployments:
  <https://github.com/mds1/multicall>
- Ethereum JSON-RPC `eth_call`:
  <https://ethereum.org/developers/apis/json-rpc/#eth_call>
- RPC maintenance and live-verification record:
  [`CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md`](./CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md)

