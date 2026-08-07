# EVM Data SDK Architecture

Version: 0.2.0

Status: v0.1 accepted; v0.2 token price aggregation implemented

Last verified: 2026-08-06

## 1. Architecture Goals

The architecture must make provider differences explicit while keeping the application-facing API small. Reliability comes from correct capability selection, bounded attempts, and typed failure behavior, not from assuming every provider is interchangeable.

The design optimizes for:

- stable public APIs for indexed EVM reads and provider-separated token price history;
- provider modules that can be understood and tested independently;
- deterministic routing by EIP-155 chain ID and operation capability;
- no precision loss in public blockchain data;
- safe, bounded fallback across credentials, proxies, and providers;
- simple addition of chains and provider adapters without editing existing adapters;
- no hidden background work, environment access, or global state.

## 2. System Context

```text
User application
      |
      v
EvmDataClient
      |
      v
AddressService / TokenService
      |
      +------------------------------+
      |                              |
      v                              v
RequestExecutor                    TokenPriceAggregator
      |                              |
ProviderRouter / ChainRegistry    PriceProviderRouter
      |                              |
CredentialPool / ProxyPool         PriceRequestExecutor / ProxyPool
      |                              |
DataProviderAdapter                TokenPriceProviderAdapter
      |                              |
      +----------- AxiosHttpTransport +-----------+
                     |
                     v
 Etherscan / Alchemy / Moralis    Binance / OKX / Coinbase / GeckoTerminal
```

The SDK is stateless with respect to blockchain data. Its only in-memory state is operational: credential/proxy selection cursors, cooldowns, and passive provider failure state. No state is persisted between processes.

## 3. Layer Boundaries

### 3.1 Public API layer

Owns the client, service namespaces, public types, and public errors. It validates caller input and never exposes upstream payloads.

### 3.2 Domain layer

Owns provider-neutral request and response semantics, chain identity, operation names, pagination contracts, and normalized errors. It has no dependency on Axios or provider response types.

### 3.3 Execution layer

Owns provider eligibility, attempt planning, time budgets, retries, credential/proxy leases, passive cooldowns, fallback, cursor validation, and telemetry events. It invokes an adapter exactly once per attempt.

### 3.4 Provider layer

Owns one upstream provider's URLs, authentication placement, request encoding, response schemas, error classification, capability predicates, paging-state encoding, and domain mapping. Provider directories must not import each other.

### 3.5 Transport layer

Owns HTTP mechanics and Node.js HTTP(S) proxy behavior. It returns a provider-neutral HTTP response or a normalized transport failure. It does not interpret provider business payloads or decide retries.

### 3.6 Price execution layer

The price path deliberately does not reuse `DataProviderAdapter` or the credential-based `RequestExecutor`. `TokenService.getPriceHistory()` normalizes a token name/symbol and UTC range, then `TokenPriceAggregator` routes enabled price adapters and delegates bounded, independent attempts to `PriceRequestExecutor`. It reuses the existing `ProxyPool`, clock, wait, telemetry, abort, and `HttpTransport` seams, while owning price-only direct/proxy-only policy and at most three retries per provider.

Every price adapter owns exact market or on-chain identity resolution, request encoding, provider-local schemas, error classification, bounded internal range chunking, UTC sorting/deduplication, and `missingDates`. The aggregator never converts, averages, fills, or substitutes values between providers. It returns ordered successful provider results plus sanitized failures, and throws `PRICE_DATA_UNAVAILABLE` only when no provider succeeds.

## 4. Proposed Package Structure

```text
src/
├── index.ts
├── client/
│   └── EvmDataClient.ts
├── services/
│   ├── AddressService.ts
│   └── TokenService.ts
├── domain/
│   ├── chains.ts
│   ├── configuration.ts
│   ├── errors.ts
│   ├── models.ts
│   ├── operations.ts
│   ├── priceModels.ts
│   ├── priceOperations.ts
│   └── pagination.ts
├── chains/
│   ├── builtinChains.ts
│   └── ChainRegistry.ts
├── execution/
│   ├── CredentialPool.ts
│   ├── ProxyPool.ts
│   ├── ProviderRouter.ts
│   ├── RequestExecutor.ts
│   ├── RetryPolicy.ts
│   └── cursorCodec.ts
├── providers/
│   ├── DataProviderAdapter.ts
│   ├── etherscan/
│   │   ├── EtherscanAdapter.ts
│   │   ├── etherscanErrors.ts
│   │   ├── etherscanMapper.ts
│   │   └── etherscanSchemas.ts
│   ├── alchemy/
│   │   ├── AlchemyAdapter.ts
│   │   ├── alchemyErrors.ts
│   │   ├── alchemyMapper.ts
│   │   └── alchemySchemas.ts
│   └── moralis/
│       ├── MoralisAdapter.ts
│       ├── moralisErrors.ts
│       ├── moralisMapper.ts
│       └── moralisSchemas.ts
├── price/
│   ├── TokenPriceProviderAdapter.ts
│   ├── PriceProviderRouter.ts
│   ├── PriceRequestExecutor.ts
│   └── TokenPriceAggregator.ts
├── providers/price/
│   ├── binance/{BinanceAdapter,binanceErrors,binanceMapper,binanceSchemas}.ts
│   ├── okx/{OkxAdapter,okxErrors,okxMapper,okxSchemas}.ts
│   ├── coinbase/{CoinbaseAdapter,coinbaseErrors,coinbaseMapper,coinbaseSchemas}.ts
│   └── geckoterminal/{GeckoTerminalAdapter,geckoTerminalErrors,geckoTerminalMapper,geckoTerminalSchemas}.ts
└── transport/
    ├── HttpTransport.ts
    └── AxiosHttpTransport.ts

tests/
├── unit/
├── contract/
├── fixtures/
├── live/
└── package/
```

There is intentionally no shared `utils`, `normalizer`, `base`, or `manager` directory. Truly shared domain behavior gets a responsibility-specific module. Provider mapping remains next to the provider schema it understands.

## 5. Module Contracts

| Module | Purpose | Input | Output | Direct dependencies | Must not own |
| --- | --- | --- | --- | --- | --- |
| `EvmDataClient` | Construct and expose the SDK | validated client configuration | `address`, `token` services | services, registry, executor composition | provider request logic |
| `AddressService` | Public address operations | public address request | transaction page or native balance | request validation, executor | retries or provider selection |
| `TokenService` | Public token operations | public transfer request | ERC-20 transfer page | request validation, executor | provider payload mapping |
| `TokenPriceAggregator` | Aggregate independent price attempts | normalized token/range request | ordered results/failures | price router, price executor | credentials or cross-provider price merging |
| `PriceProviderRouter` | Preserve configured price candidates | normalized price request | ordered price adapters | price adapter capabilities | chain routing or retries |
| `PriceRequestExecutor` | Execute bounded price attempts | adapters and normalized request | aggregation result or typed error | proxy pool, clock, wait, telemetry | credential selection, cache, health probes |
| `TokenPriceProviderAdapter` | One unauthenticated market-data attempt | price request plus route/time context | normalized price-provider result | local schema/mapper/errors, transport | retries, other providers, keys |
| `domain/*` | Stable provider-neutral contracts | none or domain values | types and pure validation helpers | Zod where runtime validation is needed | transport/provider knowledge |
| `ChainRegistry` | Resolve aliases/IDs and routing metadata | `ChainReference`, custom definitions | immutable `ResolvedChain` | built-in chain definitions | remote discovery or API calls |
| `ProviderRouter` | Filter and order eligible adapters | operation, resolved chain, request features, cursor pin | ordered adapter candidates | adapter capabilities | retry loops or HTTP |
| `RequestExecutor` | Execute one operation within a total budget | normalized operation request | normalized result or `EvmDataError` | router, pools, policy, adapters | mapping raw payloads |
| `RetryPolicy` | Pure failure-to-next-action decision | error, attempt history, remaining budget | retry/rotate/fallback/stop decision and delay | clock/random abstractions | sleeping or HTTP |
| `CredentialPool` | Lease credentials fairly and track cooldown/disable state | provider credentials and outcomes | redaction-safe credential lease | clock | logging key values |
| `ProxyPool` | Lease optional HTTP(S) proxies and track route failures | proxy configurations and outcomes | redaction-safe proxy lease | clock | provider quota decisions |
| `cursorCodec` | Encode/decode SDK continuation state | operation identity, query fingerprint, provider state | bounded opaque cursor | base64url/JSON and schema | credentials or application data |
| `DataProviderAdapter` | Define provider extension contract | one attempt context and normalized request | normalized response or normalized provider error | domain contracts, transport interface | retries and cross-provider fallback |
| Provider adapter | Encode one provider request and perform one attempt | attempt context | provider payload mapped to domain | its schemas/mapper/error classifier, transport | other provider modules |
| Provider schemas | Validate untrusted upstream data | unknown JSON | typed provider payload | Zod | domain policy |
| Provider mapper | Pure provider-to-domain conversion | validated provider payload and request context | domain model/page | provider types, domain types | network access |
| `HttpTransport` | Abstract HTTP for tests/custom transport | HTTP request plus attempt timeout/proxy/signal | status, headers, unknown body | domain transport error | provider semantics |
| `AxiosHttpTransport` | Production HTTP implementation | `HttpTransport` request | `HttpTransport` response | Axios | retries or provider routing |

## 6. Public Composition

`EvmDataClient` is the only object users need to construct, but it is not the only export. The package also exports public request/result types, `EvmDataError`, error codes, chain extension types, logger/telemetry types, and the custom provider contract.

Construction order is explicit:

1. Parse and validate client configuration.
2. Build an immutable `ChainRegistry` from built-ins plus custom definitions.
3. Build one adapter instance and one credential pool per provider configuration.
4. Build the optional proxy pool and HTTP transport.
5. Build the provider router and request executor.
6. Construct service namespaces with the executor.

No constructor makes a network request or starts a timer.

The proxy pool has three explicit configurations: no proxies with direct allowed uses the local route; proxies with direct disallowed is proxy-only; proxies with direct allowed fairly rotates proxy leases and the local direct route. Direct attempts explicitly disable Axios environment proxy discovery.

## 7. Provider Contract

The exact TypeScript generics may be refined during implementation, but the responsibilities are:

```ts
interface DataProviderAdapter {
  readonly name: string;

  supports(request: CapabilityRequest): boolean;

  getTransactions?(
    request: NormalizedTransactionRequest,
    context: ProviderAttemptContext,
  ): Promise<PageResult<Transaction>>;

  getNativeBalance?(
    request: NormalizedBalanceRequest,
    context: ProviderAttemptContext,
  ): Promise<NativeBalance>;

  getErc20Transfers?(
    request: NormalizedTransferRequest,
    context: ProviderAttemptContext,
  ): Promise<PageResult<Erc20Transfer>>;
}
```

`supports` evaluates the exact operation, chain routing metadata, and request features, including a list request's `pageSize`. The router also verifies that the corresponding method exists and centrally restricts `fullData: true` list requests to Etherscan. An adapter method normally performs one upstream attempt with the already selected credential and proxy. The explicit exception is Alchemy `direction: "both"`: one bounded composite attempt issues independent incoming and outgoing requests, then merges their complete pages. It must not select another credential, sleep, retry, or call another provider.

`ProviderAttemptContext` contains the resolved chain route, a credential lease value, optional proxy lease, attempt timeout, caller signal, and a generated correlation ID. It is internal and must never be stored in a cursor.

## 8. Chain Model

The numeric EIP-155 chain ID is canonical because aliases and provider slugs differ. A built-in chain definition has this conceptual shape:

```ts
interface ChainDefinition {
  chainId: number;
  name: string;
  alias: string;
  aliases: readonly string[];
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  routes: {
    etherscan?: { chainId: string };
    alchemy?: { httpUrlPrefix: string };
    moralis?: { chain: string };
  };
}
```

The registry is immutable after client construction. Duplicate IDs or aliases are configuration errors. Provider capability and account plan are evaluated separately from route presence.

The Etherscan route always uses the unified V2 host. Explorer website domains such as `bscscan.com`, `basescan.org`, and `polygonscan.com` are display metadata at most; they are not V2 API base URLs.

## 9. Operation Data Flow

### 9.1 First page or scalar operation

```text
Public request
  -> service validates address, chain reference, filters, page size, signal
  -> ChainRegistry resolves one immutable chain definition
  -> ProviderRouter filters capability-compatible adapters in configured order
  -> RequestExecutor starts total deadline and attempt history
  -> lease credential and optional proxy
  -> adapter builds one upstream request
  -> HttpTransport performs one cancellable HTTP attempt
  -> adapter validates envelope and classifies upstream errors
  -> adapter maps provider payload to domain model
  -> executor records success and encodes provider-pinned next cursor
  -> service returns public result
```

On a classified failure, `RetryPolicy` chooses exactly one next action: retry the route after delay, use another credential, use another proxy for a proxy failure, fall back to the next eligible provider, or stop. Every action consumes the shared attempt/time budget.

### 9.2 Continuation page

```text
Public request + SDK cursor
  -> decode and validate size/version/schema
  -> recompute query fingerprint and compare
  -> resolve pinned provider and provider paging state
  -> execute only against the pinned provider
  -> retry within that provider when allowed
  -> return next provider-pinned SDK cursor or terminal typed error
```

Cross-provider continuation is forbidden because page boundaries and snapshots are not equivalent.

### 9.3 No eligible provider

The router returns `UNSUPPORTED_CHAIN` when the chain itself is unknown. It returns `UNSUPPORTED_OPERATION` when the chain resolves but no configured adapter supports all request features. Neither path makes a network request.

## 10. Pagination Architecture

The SDK cursor is base64url-encoded, versioned JSON validated with a strict schema. It is opaque to callers, not cryptographically signed. It contains:

```text
version
operation
provider name/configuration ID
chain ID
query fingerprint
provider paging state
```

It never contains API keys, proxy data, request headers, result items, or raw URLs. The decoder rejects oversized, malformed, unknown-version, wrong-operation, wrong-chain, and wrong-query cursors as `INVALID_CURSOR`.

Provider paging state is local to each adapter:

- Etherscan: next page number and fixed offset/sort/block range.
- Moralis: provider cursor; the initial page size cannot change on continuation.
- Alchemy incoming/outgoing transfers: `pageKey`, direction, and fixed query fields.
- Alchemy both-direction transfers: two stream states (`incoming` and `outgoing`), each containing only a page key and exhausted state; the cursor contains no transfer items. A self-transfer is emitted from outgoing only, keeping the streams disjoint across continuations.

The fingerprint also contains `fullData`, so a normal Etherscan cursor cannot be reused to enter Etherscan-only mode (or vice versa). `fullData` does not add an unbounded in-SDK aggregation loop; it is a provider-selection and default-page-size mode.

The query fingerprint is a deterministic hash of normalized semantic filters, excluding `cursor`, `signal`, timeouts, credentials, and provider choice.

## 11. Reliability Model

### 11.1 Failure classes

| Failure class | Examples | Allowed action |
| --- | --- | --- |
| Caller/request permanent | invalid address, cursor mismatch, abort | stop immediately |
| Capability permanent | unsupported chain/operation | route elsewhere only if detected before attempt; otherwise stop/fallback as classified |
| Credential permanent | invalid/revoked key | disable key, try another key, then provider fallback |
| Plan restriction | Etherscan chain unavailable on free tier | mark route unavailable for cooldown, provider fallback |
| Provider throttling | HTTP 429, provider rate message | honor delay, pace/rotate authorized key when meaningful, then fallback |
| Proxy/connectivity | proxy authentication, tunnel/connect failure | penalize proxy, rotate proxy/direct route according to configuration |
| Transient network/provider | timeout, reset, selected 5xx, provider busy | jittered retry, then fallback |
| Invalid successful payload | schema mismatch | no same-payload retry by default; provider fallback and telemetry |

HTTP status alone is insufficient. Adapters inspect provider envelopes, such as Etherscan returning `status: "0"` in an HTTP 200 response or JSON-RPC returning an `error` object.

### 11.2 Attempt budget

The implementation starts with documented defaults from `SPEC.md` and keeps them configurable. The total deadline includes HTTP time, credential/proxy selection, and backoff. Nested layers do not have their own independent retry counts.

Retries use full or equal jitter and honor `Retry-After` when present. Sleep is cancellation-aware. Tests inject a clock and deterministic random source.

### 11.3 Passive health

v0.1 uses passive outcomes only:

- invalid credentials are disabled for the client lifetime unless an explicit future refresh API is added;
- rate limits and plan restrictions apply bounded cooldowns at the appropriate scope;
- transient provider failures open a short per-provider/per-chain/per-operation cooldown after a threshold;
- success reduces failure state.

There are no health-check loops or automatic ranking. Configuration order remains deterministic.

## 12. Credential and Proxy State

Pools are instance-local and concurrency-safe. A lease has an internal stable ID and secret value, but logs and errors only see a redacted label such as `etherscan-key-2` or `proxy-1`.

Credential state is scoped to a provider configuration because rate limits may be account-wide, app-wide, key-specific, endpoint-weighted, or chain/community-wide. Rotation is not assumed to increase legal quota.

Proxy state is changed only by transport evidence. A provider 401, logical `NOTOK`, invalid parameter, or account-level 429 does not imply a bad proxy. Direct connection follows `requestPolicy.allowDirect` and is never silently used when that policy is false.

## 13. Provider Designs

### 13.1 Etherscan

- Base API: `https://api.etherscan.io/v2/api`.
- Chain selection: decimal `chainid` query parameter.
- Authentication: Etherscan V2 key in the `apikey` query parameter. URLs must be redacted before observation.
- Transactions: `module=account&action=txlist`.
- Native balance: `module=account&action=balance`.
- ERC-20 transfers: `module=account&action=tokentx`.
- Pagination: page/offset, fixed query filters and sort.
- List page capacity: 1–10,000 records. This is the only built-in list adapter eligible above 1,000 records and is the exclusive `fullData` adapter.
- Special handling: an endpoint-specific no-results response is a successful empty page; other `status: "0"` values are classified errors.
- Plan behavior: BNB Smart Chain, Base, and OP access can require a paid tier even though the chain is supported.

The adapter does not use legacy per-explorer V1 API hosts or explorer-specific API keys.

### 13.2 Alchemy

- Base API: network-specific HTTPS endpoint, for example `https://eth-mainnet.g.alchemy.com/v2`.
- Chain selection: the chain registry supplies the network URL prefix.
- Native balance: JSON-RPC `eth_getBalance` at `latest`.
- ERC-20 transfers: JSON-RPC `alchemy_getAssetTransfers` with category `erc20`. Incoming and outgoing use one `toAddress` or `fromAddress`; both-direction requests make one bounded request to each stream and merge their results.
- Pagination: a single direction stores one `pageKey`; both direction stores two page keys and terminal flags. A continuation stays pinned to Alchemy and replays only its own two stream states; it never accepts an Etherscan or Moralis cursor.
- ERC-20 list page capacity: 1–1,000 per upstream stream (`maxCount` defaults to `0x3e8`). A both-direction adapter attempt makes two calls and returns their complete de-duplicated union, so a public page can contain up to 2,000 transfers.
- Authentication: `Authorization: Bearer <api-key>` header, keeping the key out of request URLs.
- Throughput: account-level compute units over a rolling window, so request count alone is not a correct model.

Alchemy does not implement `getTransactions` in v0.1. `alchemy_getAssetTransfers` is not a complete normal transaction history and must not be mapped as one. Both-direction ERC-20 pagination is a bounded, adapter-local merge of the documented incoming and outgoing streams; it has no cross-provider continuation or fallback after the first page.

### 13.3 Moralis

- Base API: `https://deep-index.moralis.io/api/v2.2`.
- Chain selection: provider chain slug/hex value from the registry.
- Authentication: `X-API-Key` header.
- Transactions: raw wallet transactions endpoint, not enriched wallet history, to align with the SDK's normal transaction semantics.
- Transaction context: `GET /transaction/{transaction_hash}` returns the
  transaction/receipt envelope and nested complete logs. The SDK validates the
  whole object and maps one hash at a time inside a bounded batch. This is an
  explicit caller operation, never an SDK background refresh or backend sync
  hook. The public batch is capped at 20 hashes; normalized results are cached
  for 60 seconds and identical in-flight hashes are coalesced.
- Native balance: `GET /{address}/balance`.
- ERC-20 transfers: `GET /{address}/erc20/transfers`.
- ERC-20 holdings/snapshots: `GET /{address}/erc20` with `chain` and required
  `to_block`. For current holdings, the API-chain service resolves an indexed
  Etherscan head before issuing the Moralis request. The upstream response is an unpaged wallet-balance array. The
  adapter validates it in full and only returns requested-contract balances;
  it never exposes the provider's full wallet inventory through the explicit
  historical-balance operation.
- Pagination: provider cursor with fixed initial limit and point-in-time behavior where supported.
- List page capacity: 1–100 records.
- Rate behavior: request throughput over a rolling four-second window; endpoint costs and plan rules can evolve.

The adapter maps raw integer fields and does not use provider-formatted decimal values as the source of truth.

## 14. Dependency Direction

```text
client/services
      |
      v
domain contracts <----- chains/execution
      ^                       |
      |                       v
provider adapters ------> transport interface
                                |
                                v
                         Axios implementation
```

Rules:

- Domain modules import no client, execution, provider, or transport implementation.
- Services depend on the executor contract, not concrete providers.
- Provider modules depend on domain contracts and the transport interface.
- The Axios implementation depends on Axios but no provider modules.
- Composition happens only in `EvmDataClient` or a dedicated internal factory if the constructor becomes unreadable.
- Tests may inject fakes through narrow constructor parameters; no service locator or global container is introduced.

## 15. Validation and Precision

Zod validates configuration, public inputs that require runtime narrowing, cursors, and provider responses. Schemas should use `.passthrough()` only when explicitly justified for upstream forward compatibility; mapped fields are still required and checked.

Hex and decimal quantities are converted with `BigInt` internally and serialized as canonical base-10 strings. No arithmetic uses floating-point numbers. Token `decimals` is a small validated integer and may be `null` when unavailable.

Provider timestamps are normalized to ISO UTC. Impossible timestamps produce `INVALID_PROVIDER_RESPONSE`; absence remains `null` only when the operation contract permits it.

## 16. Security and Privacy

- Secrets enter through explicit configuration and remain in internal leases.
- A single redaction function handles URL query keys, authorization headers, proxy userinfo, and known secret values before errors or telemetry leave the SDK.
- Cursor state is treated as public and contains no secrets.
- Error causes may be retained internally, but public serialization and inspection must be redaction-safe.
- Tests include malicious URLs, encoded credentials, Axios error objects, and provider payload echoes.
- Provider URL overrides are validated and disabled by default for insecure non-loopback HTTP.
- Explicit `allowInsecureHttp` is passed from normalized configuration into every built-in adapter so compatible non-loopback test gateways work only when opted in.
- Public `EvmDataError.cause` values are reduced to safe type/error metadata; raw upstream causes are never exposed through error inspection or JSON serialization.
- The SDK performs read-only operations and never accepts private keys or signed transactions.

## 17. Testing Architecture

### Unit tests

Cover chain resolution, configuration, cursor codec, mappers, error classifiers, retry decisions, credential/proxy state, and redaction as pure or deterministic units.

### Adapter contract tests

Run every adapter against fixture responses through a fake `HttpTransport`. Cover success, empty results, pagination, malformed 2xx payloads, auth failure, plan restriction, rate limit, timeout, and provider busy responses.

### Execution integration tests

Use scripted fake adapters, fake clock, and deterministic random values to verify exact attempt order, total budget, cancellation, capability filtering, first-page fallback, and continuation pinning.

### Live tests

Live provider tests are opt-in and skipped by default. They use environment variables owned by the test runner, make low-volume read calls, never print keys, and assert only stable semantic properties.

### Package tests

Pack the tarball and consume it from tiny ESM, CommonJS, and TypeScript projects. Verify exports, declarations, source maps, and absence of repository-only files or secrets.

## 18. Extension Paths

### Add a chain

Add one immutable `ChainDefinition`, provider route metadata, chain-resolution tests, and capability fixtures. Existing adapters should require no control-flow changes if their route formats already support the chain.

### Add a provider

Create one provider directory implementing the adapter contract, schemas, mapper, error classifier, fixtures, and integration entry. Add official documentation to `INTEGRATIONS.md` first. Existing provider directories and services remain unchanged.

### Add an operation

Define its semantics and public model in `SPEC.md`, add a domain operation request, extend capabilities, add one service method, then implement only genuinely equivalent provider endpoints. Unsupported adapters remain explicitly ineligible.

### Add caching or metrics

Caching belongs around normalized operation results and must define cursor/finality semantics before adoption. Metrics belong behind an optional telemetry sink. Neither concern enters provider mappers.

## 19. v0.3 Extensions (accepted; implementation in progress)

The following boundaries are proposed in
[`PROXY_AND_BLOCK_RANGE_UPGRADE.md`](./PROXY_AND_BLOCK_RANGE_UPGRADE.md). They
are accepted by the owner through ADR-023 and ADR-024. Their implementation
must preserve all accepted v0.2 contracts.

### Managed advanced proxy

```text
advancedProxy URLs
       |
       v
SingBoxUrlParser -> SingBoxConfigBuilder -> SingBoxRuntime
                                      |             |
                                      +--> local mixed HTTP inbound
                                                    |
                                                    v
                                           ProxyPool / HttpTransport
```

`SingBoxBinaryManager` owns only fixed-version download, digest verification,
cache and executable permissions. `SingBoxRuntime` owns one child process,
loopback readiness, temporary config and bounded shutdown. `SingBoxProxyManager`
adapts the runtime to a local HTTP `ProxyLease`. Existing request and price
executors remain protocol-agnostic. No SDK module reads `.env.key`, accepts
arbitrary sing-box JSON, or binds a non-loopback inbound.

### Block-range scanner

```text
getErc20TransfersByBlockRange
       -> range validation
       -> capability-aware provider selection
       -> coverage-ledger BlockRangeScanner
       -> provider-local fresh range / dual-stream adapter
       -> split overflowing windows + provider-explicit dedup/sort
       -> complete Erc20BlockRangeResult
```

The scanner is a sibling of the existing cursor-based `RequestExecutor`, not a
recursive call to a public page API. It owns a closed-range coverage ledger,
window splitting, provider-explicit provenance and a total record safety bound;
adapters own their provider's maximum page size, block filter encoding,
terminal signal and response mapping. An overflowing window is split and each
child is re-requested without carrying a provider cursor/page state. Different
completed windows may use different providers, but the result cannot silently
mix them: every item retains its provider and the aggregate reports the
providers and completed-window counts.

### Proposed module contracts

| Module | Owns | Must not own |
| --- | --- | --- |
| `SingBoxUrlParser` | VLESS/SS URL validation and safe internal representation | process, HTTP, logs |
| `SingBoxBinaryManager` | fixed asset mapping, download, digest, cache | proxy selection, provider retries |
| `SingBoxRuntime` | child process and loopback readiness/cleanup | URL interpretation, API credentials |
| `SingBoxProxyManager` | runtime-to-local-HTTP lease and async initialization | Axios request semantics |
| `BlockRangeScanner` | closed-range coverage ledger, split progress, dedup, ordering, provenance, safety bound | provider URL/schema details |
| provider range adapter | provider-specific fresh range filter, page limit and terminal signal | cross-provider coverage, public retry loops |

All new loops must be bounded, abortable and total-time aware. New runtime
resources must be released by `EvmDataClient.close()`.

### API-only chain metadata boundary

Address range scans and chain height lookups are indexed API operations. They
must not call `eth_*` JSON-RPC methods or provider RPC proxy endpoints.
Finality is an application policy (`latest API height - lag`), not an SDK RPC
tag.

The API-only address extensions are deliberately scoped to indexed Etherscan
account endpoints. `AddressService` validates the same closed range request as
top-level transactions, then delegates to `ApiChainService`; the Etherscan
adapter owns schemas, mapping, bounded paging and error classification. No
trace RPC, JSON-RPC proxy, raw provider pagination or credential reaches a
business caller.

`TokenService` also delegates two non-RPC snapshot operations to
`ApiChainService`: current `addresstokenbalance` holdings discovery and exact
`tokenbalancehistory` reads for caller-supplied contract addresses. The
Etherscan adapter owns their schema, canonical decimal mapping and documented
two-request-per-second pacing. `ApiChainService` acquires the same configured
HTTP or managed sing-box route as the rest of the client, so
`allowDirect: false` cannot bypass VLESS for chain-height, internal-transfer,
Beacon, holdings, or historical-balance APIs.

## 20. Rejected Draft Elements

- A single `BaseProvider` inheritance tree: replaced by a small compositional adapter contract.
- A universal `normalizer` directory: mappings stay provider-local so a file is understandable with its schema.
- Generic `utils`, `manager`, and `logger` modules: replaced with named responsibilities and injected observation callbacks.
- Round-robin keys as rate-limit avoidance: replaced with scoped credential state and conservative pacing.
- Proxy rotation on every provider error: replaced with transport-specific proxy classification.
- Background provider health checks in v0.1: replaced with passive cooldowns and deterministic priority.
- Raw `Transaction[]` list responses: replaced with page metadata and provider-pinned opaque cursors.
- `number` for blockchain quantities: replaced with decimal strings.
- Alchemy asset transfers as full transactions: rejected because the semantics are not equivalent.

## 21. Approval Gate

Implementation is authorized for the accepted v0.3 architecture. Any future material design change must be applied consistently to `SPEC.md`, this file, `DECISIONS.md`, and `NEXT_SESSION.md` before creating source for that change.
