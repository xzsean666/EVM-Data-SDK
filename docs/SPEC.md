# EVM Data SDK Specification

Version: 0.4.0

Status: v0.1/v0.2/v0.3 accepted; v0.4 Chainlink Archive RPC snapshot approved 2026-08-07

Last verified: 2026-08-07

## 1. Purpose

EVM Data SDK is a lightweight, Node.js-first TypeScript library that provides stable read-only access to indexed EVM data across Etherscan, Blockscout, Alchemy, and Moralis, plus token price history aggregated from public market-data providers. It gives applications one public model and one failure contract while preserving provider capability differences explicitly.

The SDK does not promise that every provider can satisfy every operation. It selects and falls back only among providers that can satisfy the same semantic contract for the requested chain and options.

## 2. Scope

### 2.1 Public operations

```ts
const client = new EvmDataClient(configuration);

const transactions = await client.address.getTransactions({
  chain: "ethereum",
  address: "0x0000000000000000000000000000000000000000",
  pageSize: 50,
  order: "desc",
  signal,
});

const balance = await client.address.getNativeBalance({
  chain: 1,
  address: "0x0000000000000000000000000000000000000000",
  signal,
});

const transfers = await client.token.getErc20Transfers({
  chain: "ethereum",
  address: "0x0000000000000000000000000000000000000000",
  direction: "both",
  pageSize: 50,
  signal,
});

const prices = await client.token.getPriceHistory({
  token: "Ethereum",
  range: { kind: "latest", days: 30 },
});

const contexts = await client.address.getTransactionContextsByHash({
  chain: "ethereum",
  transactionHashes: ["0x..."],
});
```

The exact compile-ready types are an implementation deliverable. The semantic contracts in this specification are fixed unless the architecture is amended.

For the built-in adapters, `ProviderName` is `"etherscan" | "blockscout" | "alchemy" | "moralis"`. Custom adapters use a validated non-empty provider name string and remain distinguishable in provenance and cursors.

### 2.2 Initial built-in chains

| Canonical alias | EIP-155 chain ID | Native symbol |
| --- | ---: | --- |
| `ethereum` | 1 | ETH |
| `bsc` | 56 | BNB |
| `polygon` | 137 | POL |
| `arbitrum` | 42161 | ETH |
| `base` | 8453 | ETH |
| `optimism` | 10 | ETH |

The registry may include aliases such as `eth`, `bnb-smart-chain`, and `op`, but outputs always contain the numeric `chainId`. A built-in chain does not imply that every configured provider or account plan supports every operation on it.

Custom chain definitions may be supplied in configuration. They must include a unique EIP-155 chain ID, canonical alias, native currency metadata, and provider routing metadata for every intended adapter.

### 2.3 Provider capability baseline

`yes` means the v0.1 adapter is intended to implement the operation where that provider supports the selected chain and the user's account plan permits it.

| Operation | Etherscan V2 | Blockscout compatible | Alchemy | Moralis Data API |
| --- | --- | --- | --- | --- |
| Normal address transactions | yes: `account/txlist` | yes: `account/txlist` | no: asset transfers are not complete transactions | yes: raw wallet transactions |
| Latest native balance | yes: `account/balance` | yes: `account/balance` | yes: `eth_getBalance` | yes: native balance |
| ERC-20 transfers, both directions | yes | yes: `account/tokentx` | yes: bounded two-stream `alchemy_getAssetTransfers` merge | yes |
| ERC-20 transfers, incoming or outgoing | yes, with SDK-side filtering | yes, with SDK-side filtering | yes: `alchemy_getAssetTransfers` | yes, with SDK-side filtering |

The router must evaluate request features, not only method names. Alchemy is eligible for an ERC-20 request in every direction through 1,000 records; `direction: "both"` is a bounded merge of Alchemy's independent incoming and outgoing streams. Alchemy remains ineligible for normal transaction history because asset transfers are not complete transactions.

### 2.4 Meaning of the operations

`getTransactions` returns top-level, mined EVM transactions involving the address as sender or recipient. It does not include internal calls as independent transactions, pending transactions, ERC-20 events that do not otherwise involve the address at the transaction envelope level, or decoded activity summaries.

`getNativeBalance` returns the balance at the provider's latest block. Historical block selection is out of scope for v0.1 because providers have materially different archive limitations.

`getErc20Transfers` returns mined ERC-20 `Transfer` events indexed for the wallet, optionally filtered to one token contract and one direction. It does not return current token balances, approvals, NFTs, or internal native transfers.

`getErc20TokenHoldings` returns a current indexed holding list for one wallet.
It is discovery metadata only, not a historical balance assertion.
`getErc20BalancesAtBlock` then reads one exact block for an explicit,
caller-supplied ERC-20 contract set. Etherscan reads each contract through
`tokenbalancehistory`; Moralis reads its complete REST wallet-balance snapshot
and projects it onto that same set. A projected Moralis omission is a zero only
after the full snapshot was validated successfully. The SDK does not offer an
operation that claims to enumerate every token ever held by a wallet at a
historic block.

`getPriceHistory` returns independently sourced daily OHLCV histories for a token name or symbol. The four default sources are Binance Spot, OKX Spot, Coinbase Exchange Spot, and GeckoTerminal. It is an aggregation rather than a merged consensus price: each successful source remains a separate result with its actual market and quote asset.

`getTransactionContextsByHash` returns one indexed transaction context per
requested mined hash, including receipt status, gas-used/effective-gas-price
fields, and every receipt log with topics and data. It is a bounded batch
operation with no provider cursor. Moralis Data API is the current API-only
provider; Alchemy JSON-RPC and Etherscan proxy/RPC endpoints are not semantic
fallbacks for this operation. It is explicitly caller-driven: the SDK does not
schedule it, and the backend portfolio/onboarding synchronization path does
not call it. A UI that needs context may obtain and parse it on demand through
its own chosen frontend data source. Each call accepts at most 20 hashes; a
client caches normalized mined contexts for 60 seconds and coalesces identical
in-flight reads, without a background refresh timer.

### 2.5 Request normalization

- List requests default to `pageSize: 50` and `order: "desc"`. Accepted page sizes are integers from 1 through 10,000. Provider eligibility is page-size-aware: Moralis accepts 1–100, Alchemy accepts 1–1,000 for ERC-20 operations, and Etherscan accepts 1–10,000 for list operations.
- `fullData: true` is available on list requests. It restricts the request (and every retry) to configured Etherscan-compatible Etherscan or Blockscout adapters. When `pageSize` is omitted in this mode, it uses a 10,000-record logical page; each adapter may use smaller physical pages. The name does **not** mean that one SDK call aggregates every historical record: callers must follow `nextCursor` until it is `null`.
- ERC-20 transfer requests default to `direction: "both"` and may specify one structurally valid `tokenAddress`.
- For Alchemy `direction: "both"`, `pageSize` is applied to each upstream stream. One SDK page returns the complete de-duplicated union of those two upstream pages, so it may contain up to `2 × pageSize` transfers. A self-transfer is assigned to outgoing only, so it cannot be repeated when the independent stream cursors advance at different rates. Its next cursor contains only the two Alchemy continuation states.
- Optional `startBlock` and `endBlock` filters are decimal strings. They are normalized without leading zeroes, and `startBlock` must not exceed `endBlock`.
- Addresses are structurally validated as 20-byte `0x` hexadecimal strings and normalized to lowercase. No checksum validation is performed in v0.1.
- Input aliases are trimmed and normalized to lowercase before chain resolution. An opaque continuation cursor is retained byte-for-byte for the cursor codec to validate in Work Package 4.
- Price-token input is trimmed and normalized for matching while the original input is preserved in output. Built-in aliases resolve `ETH`/`Ethereum` and `BTC`/`Bitcoin`; `price.tokenAliases` may add application-specific aliases.
- Price ranges use UTC `YYYY-MM-DD` only. `latest` is inclusive and accepts 1 through 365 days; `date` selects one UTC day; `between` is inclusive, must be ordered, and may contain at most 366 days. Future dates and dates more than ten years in the past fail before network work.

## 3. Public Data Contracts

### 3.1 Common rules

- Addresses and hashes use `0x`-prefixed hexadecimal strings.
- The SDK accepts mixed-case addresses, validates them structurally, and returns lowercase addresses for deterministic equality. Checksum validation is not performed in v0.1.
- Block numbers, token quantities, native quantities, gas, gas price, nonce, and indices are base-10 strings to avoid precision loss.
- Timestamps are ISO 8601 UTC strings or `null` when a semantically valid provider response does not supply one.
- Missing upstream data is represented by `null`; it is not fabricated as zero or an empty string.
- Public results contain provider provenance.

### 3.2 Page

```ts
interface Page<T> {
  items: T[];
  nextCursor: string | null;
  pageInfo: {
    provider: ProviderName;
    chainId: number;
  };
}
```

`nextCursor` is an opaque SDK cursor. Callers must pass it back unchanged with the same operation and query filters. The cursor pins subsequent pages to the original provider. A provider outage during continuation returns a typed error rather than silently switching data sets.

### 3.3 Transaction

```ts
interface Transaction {
  chainId: number;
  hash: string;
  blockNumber: string;
  blockHash: string | null;
  transactionIndex: string | null;
  timestamp: string | null;
  from: string;
  to: string | null;
  nonce: string | null;
  value: string;
  gasLimit: string | null;
  gasUsed: string | null;
  gasPrice: string | null;
  input: string | null;
  status: "success" | "reverted" | "unknown";
  provider: ProviderName;
}
```

`value` is the raw native amount in the chain's smallest unit. Contract creation has `to: null`.

### 3.4 Native balance

```ts
interface NativeBalance {
  chainId: number;
  address: string;
  amount: string;
  decimals: number;
  symbol: string;
  blockNumber: string | null;
  provider: ProviderName;
}
```

`amount` is the raw integer amount. The SDK does not return floating-point display values.

### 3.5 ERC-20 transfer

```ts
interface Erc20Transfer {
  chainId: number;
  transactionHash: string;
  logIndex: string | null;
  blockNumber: string;
  timestamp: string | null;
  tokenAddress: string;
  tokenName: string | null;
  tokenSymbol: string | null;
  tokenDecimals: number | null;
  from: string;
  to: string;
  amount: string;
  provider: ProviderName;
}
```

`amount` is the raw event integer. Transfer identity is `(chainId, transactionHash, logIndex)` when `logIndex` is available. The mapper must not invent a log index.

### 3.5a ERC-20 holdings and exact historical balances

```ts
interface Erc20TokenHoldings {
  chainId: number;
  address: string;
  items: readonly {
    tokenAddress: string;
    tokenName: string | null;
    tokenSymbol: string | null;
    tokenDecimals: number | null;
    amount: string; // current raw quantity, discovery only
  }[];
  provider: ProviderName;
  pages: number;
  upstreamRequests: number;
}

interface Erc20BalancesAtBlock {
  chainId: number;
  address: string;
  blockNumber: string;
  items: readonly {
    tokenAddress: string;
    amount: string; // exact historical raw quantity
    blockNumber: string;
    provider: ProviderName;
  }[];
  provider: ProviderName;
}
```

Both operations are indexed Etherscan API calls. `getErc20TokenHoldings` is
useful for selecting contracts that are still held; callers must union that
list with contracts observed in their own historical transfer range before
requesting exact historical balances. Etherscan documents both endpoints as
Standard-plan-and-above, capped at two requests per second. The SDK serializes
these endpoint calls per Etherscan adapter and never uses RPC as a fallback.

### 3.6 Token price history

```ts
type TokenPriceRange =
  | { kind: "latest"; days: number }
  | { kind: "date"; date: string }
  | { kind: "between"; startDate: string; endDate: string };

interface TokenPricePoint {
  date: string;                 // UTC YYYY-MM-DD
  timestamp: string;            // UTC ISO timestamp for the daily bucket
  open: string;
  high: string;
  low: string;
  close: string;
  price: string;                // always equal to close
  volume: string | null;
  isFinal: boolean | null;
}

interface TokenPriceProviderResult {
  provider: "binance" | "okx" | "coinbase" | "geckoterminal";
  status: "success";
  token: { input: string; normalized: string; symbol: string; name: string | null };
  market: {
    product: string;
    quoteAsset: "USD" | "USDT";
    sourceKind: "exchange" | "onchain";
    network: string | null;
    tokenAddress: string | null;
    poolAddress: string | null;
  };
  interval: "1d";
  timezone: "UTC";
  requestedRange: { kind: TokenPriceRange["kind"]; startDate: string; endDate: string };
  points: readonly TokenPricePoint[];
  missingDates: readonly string[];
}

interface TokenPriceAggregationResult {
  query: {
    tokenInput: string; normalizedToken: string; interval: "1d"; timezone: "UTC";
    range: TokenPriceRange; resolvedStartDate: string; resolvedEndDate: string;
  };
  results: readonly TokenPriceProviderResult[];
  failures: readonly { provider: string; code: string; retryable: boolean; message: string }[];
  summary: { requestedProviders: number; succeededProviders: number; failedProviders: number; partial: boolean };
}
```

All public prices and volumes are decimal strings; JavaScript `number` is never used for a returned price or volume. Results are sorted by UTC date ascending. `missingDates` lists every requested date absent from an otherwise successful provider response, and the SDK never fabricates a zero, previous close, or other replacement value. The current UTC bucket is not final.

Exchange adapters independently select only the specified active Spot market: Binance `BASEUSDT`, OKX `BASE-USDT`, and Coinbase `BASE-USD`. USDT is never silently converted to USD. GeckoTerminal resolves an on-chain network, token contract, pool, and token side before requesting the selected token's USD OHLCV; equal-strength identities that cannot be safely distinguished fail with `TOKEN_AMBIGUOUS`. An exchange symbol and an on-chain contract sharing a symbol are not asserted to be the same asset.

## 4. Functional Requirements

### FR-001 Configuration validation

The client must validate configuration during construction and fail before any network request. Configuration includes ordered providers, provider credentials, optional chain definitions, request policy, optional HTTP(S) proxies, and optional logger/telemetry callbacks. The SDK must not read provider keys implicitly from environment variables.

### FR-002 Provider selection

The router must select providers in caller-configured priority order after filtering by chain, operation, and request features. It must return `UNSUPPORTED_OPERATION` without a network call when no provider is eligible.

For list requests, page size is an exact capability feature. A request for 1,000 records may route only to eligible Alchemy, Etherscan, and Blockscout adapters (Alchemy remains limited to ERC-20 transfers); a request for 1,001 through 10,000 records may route only to Etherscan-compatible Etherscan/Blockscout adapters. `fullData: true` applies that same restriction even when a smaller page size was explicitly supplied. Eligible candidates remain ordered by the caller's provider configuration and are tried serially under the existing bounded fallback policy.

### FR-003 Provider fallback

The executor may fall back on the first page or a non-paginated operation after a retryable provider failure. It must not fall back for invalid input, caller cancellation, or an already issued continuation cursor.

### FR-004 Credential pool

Credentials belong to one provider configuration. Selection must be concurrency-safe and fair among usable keys. Invalid credentials are disabled; rate-limited credentials enter a bounded cooldown; successful calls restore health gradually. Rotation manages caller-authorized credentials and must not be described or implemented as quota evasion.

### FR-005 Rate limiting

The client must support conservative, configurable per-provider request pacing. Provider response headers and documented retry delays take precedence. Defaults must not claim to infer a user's paid plan.

### FR-006 Proxy pool

HTTP(S) proxies are optional and Node.js-only. Selection is concurrency-safe. A proxy enters cooldown only for proxy/connectivity failures. Provider authentication, validation, and quota errors must not penalize or rotate the proxy. Proxy credentials are always redacted.

### FR-007 Retry budget

Retries apply only to read operations and classified transient failures such as network failures, timeouts, HTTP 429, and selected 5xx responses. The executor must honor `Retry-After`, use exponential backoff with jitter, and enforce both a total attempt limit and an overall deadline across key, proxy, and provider changes.

### FR-008 Cancellation and timeout

Every public operation accepts an `AbortSignal`. Caller cancellation must stop backoff and active transport work and return `REQUEST_ABORTED`. Each attempt and the overall operation have explicit configurable timeouts.

### FR-009 Validation and mapping

Each adapter validates the upstream envelope and maps it directly to public domain models inside the provider directory. Unexpected successful payloads return `INVALID_PROVIDER_RESPONSE`. Provider raw types must not leak through public exports.

### FR-010 Pagination

List operations use SDK-owned versioned cursors. A cursor contains no credential or proxy information, has a maximum accepted size, identifies its operation/provider/chain, includes a query fingerprint, and carries only the minimal provider paging state. Reusing a cursor with changed filters returns `INVALID_CURSOR`.

### FR-011 Etherscan response semantics

The Etherscan adapter uses only V2. It must distinguish a documented empty list response such as "No transactions found" from an actual `status: "0"` error. It must classify plan restrictions, invalid keys, unsupported chains, timeouts, and rate limits separately.

### FR-012 Observability

The default logger is silent. Optional structured events may report operation, chain ID, provider, attempt number, duration, outcome, and normalized error code. They must never contain API keys, full proxy URLs with credentials, authorization headers, or provider cursors.

### FR-013 Lifecycle

The client must not start background timers. If a transport later requires disposable resources, the public client must expose an idempotent `close()` method; v0.1 should avoid requiring one unless needed.

### FR-014 Custom providers

The provider contract is exported for advanced users. A custom adapter must declare a unique name, evaluate capabilities for a resolved chain and request, perform one upstream attempt, validate/map its result, and return normalized errors. Custom adapters use the same central execution policy.

### FR-015 Price aggregation

Price adapters are independent of blockchain `DataProviderAdapter`, credentials, and credential rotation. Every enabled adapter receives one bounded attempt, and enabled adapters execute concurrently up to the configured maximum of four. The successful results and failures retain configured order. Four successes return four results; any nonzero success count returns a result with every failure listed and `summary.partial: true` where applicable; zero successes reject with `PRICE_DATA_UNAVAILABLE`.

Price retry is bounded to three attempts per provider and applies only to classified network, timeout, 429, selected 5xx/provider-busy, and proxy failures. Invalid input, ambiguity, unavailable markets, malformed payloads, and absent proxy-only routes are not retried. No price API key, `CredentialPool`, environment key, cache, websocket, background health probe, or direct fallback from `proxy-only` is used.

### FR-016 Price routing

`price.routeMode` is independent of `requestPolicy.allowDirect`. `direct` is the default and explicitly supplies Axios `proxy: false`, so environment proxy variables do not alter price routing. `proxy-only` leases only an explicitly configured HTTP(S) proxy and returns `PROXY_ERROR` if none is available; it never falls back to a local route. The existing transport, timeout, abort, retry-wait, redaction, and telemetry boundaries are reused.

## 5. Error Contract

Public methods reject with `EvmDataError`.

```ts
type ErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_REQUEST"
  | "INVALID_CURSOR"
  | "UNSUPPORTED_CHAIN"
  | "UNSUPPORTED_OPERATION"
  | "AUTHENTICATION_FAILED"
  | "PLAN_RESTRICTED"
  | "RATE_LIMITED"
  | "REQUEST_TIMEOUT"
  | "REQUEST_ABORTED"
  | "NETWORK_ERROR"
  | "PROXY_ERROR"
  | "INVALID_PROVIDER_RESPONSE"
  | "PROVIDER_UNAVAILABLE"
  | "TOKEN_NOT_FOUND"
  | "TOKEN_AMBIGUOUS"
  | "MARKET_NOT_FOUND"
  | "HISTORY_NOT_AVAILABLE"
  | "PRICE_DATA_UNAVAILABLE";

interface EvmDataError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly provider: string | null;
  readonly chainId: number | null;
  readonly retryAfterMs: number | null;
  readonly cause?: unknown;
}
```

Messages must be useful without exposing secrets. The final error may include sanitized attempt summaries, but not raw request URLs or headers.

## 6. Configuration Requirements

The intended configuration shape is explicit and tagged by provider:

```ts
const client = new EvmDataClient({
  providers: [
    {
      kind: "etherscan",
      apiKeys: [process.env.ETHERSCAN_API_KEY!],
    },
    {
      kind: "alchemy",
      apiKeys: [process.env.ALCHEMY_API_KEY!],
    },
    {
      kind: "moralis",
      apiKeys: [process.env.MORALIS_API_KEY!],
    },
  ],
  requestPolicy: {
    attemptTimeoutMs: 10_000,
    totalTimeoutMs: 30_000,
    maxTotalAttempts: 6,
    allowDirect: false,
  },
  proxies: [
    { url: "http://127.0.0.1:7890" },
  ],
});
```

Environment access in this example belongs to the application. The SDK receives strings and does not load `.env` files.

Provider base URL overrides are allowed for tests and compatible gateways. Production defaults use HTTPS. Insecure HTTP provider URLs require an explicit `allowInsecureHttp` opt-in; loopback test URLs are permitted.

Provider URL overrides and proxy URLs are validated during client construction. Proxy URLs may contain HTTP(S) userinfo but no path, query, or fragment; invalid proxy syntax fails as `INVALID_CONFIGURATION` before network work.

`requestPolicy.allowDirect` defaults to `true`. Set it to `false` when every attempt must use one of the explicitly configured HTTP(S) proxies; the executor never silently bypasses that policy.

When `allowDirect` is `true` and proxies are configured, the SDK fairly rotates each request through configured proxies and the local direct route. When no proxies are configured, the local direct route is the only route. This routing is transport scheduling, not a quota-bypass promise.

Price configuration is separate and API-key-free:

```ts
const client = new EvmDataClient({
  price: {
    routeMode: "direct",
    // Omit providers for Binance, OKX, Coinbase, GeckoTerminal in that order.
    maxProviderConcurrency: 4,
    tokenAliases: { ether: "ETH" },
  },
});
```

`price.providers` may declare an ordered enabled subset and test-only base URL overrides. A price-only client is valid; a blockchain-only client retains the default four price providers unless it explicitly supplies `price.providers`. `price.geckoNetworks` defaults to Ethereum, BNB Smart Chain, Polygon, Arbitrum, Base, and Optimism GeckoTerminal identifiers.

## 7. Non-Functional Requirements

- Runtime: supported Node.js LTS releases, with Node.js 24 as the development baseline.
- Package: ESM and CommonJS entry points plus `.d.ts` declarations.
- Correctness: no public integer precision loss and no cross-provider pagination.
- Security: secrets redacted from logs, errors, cursors, snapshots, and test output.
- Reliability: deterministic bounded retries and cancellation-aware waits.
- Maintainability: provider modules can be read and tested independently.
- Extensibility: a new provider should not require changes to existing provider directories or public services beyond registration and chain metadata.
- Compatibility: public APIs follow semantic versioning; v0.x may evolve only through documented decisions and changesets.
- Testability: all time, randomness, and HTTP behavior used by resilience logic must be injectable or controllable in tests.
- Performance: no N+1 hydration in v0.1; one public request may make multiple attempts but no unbounded fan-out.

## 8. User Scenarios

### Reliable portfolio backend

A backend requests the latest native balance. Alchemy is temporarily rate-limited, so the executor honors cooldown and falls back to Moralis within the total request budget. The returned result identifies Moralis as the source.

### Transaction history pagination

A caller requests Ethereum transactions. Etherscan returns page one and an SDK cursor. Page two remains pinned to Etherscan. If Etherscan is unavailable, the SDK returns a typed continuation error instead of mixing Moralis pagination into the data set.

### BNB Smart Chain through Etherscan

The caller uses `chain: "bsc"`. The SDK resolves chain ID 56 and calls `https://api.etherscan.io/v2/api?chainid=56...`; it does not call the legacy BscScan V1 API domain. A free-plan restriction is classified as `PLAN_RESTRICTED` and may trigger fallback to another eligible provider.

### ERC-20 transfer query

A caller requests ERC-20 transfers. Alchemy is eligible for incoming or outgoing because each maps to one `alchemy_getAssetTransfers` stream. For `direction: "both"`, it fetches one page for each stream, returns their complete de-duplicated union, and pins the continuation cursor to those two Alchemy streams.

### Cancellation

A caller aborts while the executor is in backoff. The wait terminates immediately, no other key/provider is tried, and the operation rejects with `REQUEST_ABORTED`.

## 9. Non-Goals

- Running a blockchain node or indexer
- Transaction signing, broadcasting, wallet custody, or nonce management
- Pending transaction subscriptions or WebSockets
- Internal transaction/call traces as a unified v0.1 operation
- NFT transfers, contract events, decoded activity, ABI services, or an
  unbounded automatic enumeration of every historical wallet token
- Price quote conversion, consensus/median prices, contract-address input, caching, websocket streams, or background market-health checks
- Persistent cache, database storage, metrics exporters, automatic provider ranking, or background health checks
- Browser proxy support
- Automatic discovery of every chain exposed by upstream providers
- Hiding plan, indexing, archive, and semantic limitations of upstream providers

## 10. Acceptance Criteria for v0.1

- The three public operations and public model/error contracts are documented and exported.
- All six built-in chains resolve deterministically, with capability checks before requests.
- Etherscan, Moralis, and the scoped Alchemy capabilities in section 2.3 have fixture-backed adapter tests.
- First-page fallback, provider-pinned continuation, key cooldown, proxy classification, total retry budget, timeout, and abort behavior have deterministic tests.
- ESM import, CommonJS require, and TypeScript declaration smoke tests pass from the packed tarball.
- No live credentials are needed for the default test suite; opt-in live tests are documented separately.
- Type checking, linting, unit tests, build, and package validation pass.
- All required documentation reflects the implementation and `docs/NEXT_SESSION.md` has no unresolved release blockers.

## 11. Acceptance Criteria for v0.2 Price Aggregation

- `client.token.getPriceHistory()` supports `latest`, `date`, and inclusive `between` UTC selectors with documented boundary validation.
- Binance Spot, OKX Spot UTC day candles, Coinbase Exchange Spot, and GeckoTerminal USD pool OHLCV use provider-local schemas, mappers, error classifiers, and fixtures.
- Results contain decimal-string OHLCV, `price === close`, ascending UTC points, explicit `missingDates`, source market/quote metadata, and GeckoTerminal network/contract/pool identity.
- Four-success, partial-success, all-failure, direct, proxy-only, 429, selected 5xx, timeout, caller abort, redaction, chunk/deduplication, and ambiguity cases are deterministic tests.

## 12. v0.3 Upgrade Proposal: Advanced Proxy and Block-Range Reads

This v0.3 section is accepted by the owner on 2026-08-06. The full design,
examples, algorithms, security requirements, and implementation queue are in
[PROXY_AND_BLOCK_RANGE_UPGRADE.md](./PROXY_AND_BLOCK_RANGE_UPGRADE.md).

### 12.1 Advanced proxy

Add an independent `advancedProxy.kind: "sing-box"` configuration accepting a
non-empty list of `vless://` or `ss://` URLs. The SDK must lazily prepare a
fixed-version sing-box binary for `linux|darwin|win32 × x64|arm64`, verify its
SHA-256 release digest, run a loopback-only `mixed` inbound, and expose only a
local HTTP proxy to the existing execution and price transport paths. No
binary is shipped in the npm tarball, no unconditional `postinstall` download
is allowed, and no implicit `.env`/proxy environment read is introduced.

`requestPolicy.allowDirect: false` must apply to this route as well as existing
HTTP(S) proxies. If the advanced runtime cannot start, the SDK must return a
typed proxy/runtime error rather than silently sending credentials over a
direct route. URL secrets, temporary config, child-process output, and runtime
metadata must be redacted or removed on close.

### 12.2 Block-range ERC-20 operation

Add `client.token.getErc20TransfersByBlockRange()` with a required address,
chain, and inclusive decimal-string `startBlock`/`endBlock`; direction defaults
to `both`, and one token-address filter remains optional. The public request
does not contain `pageSize`, and a successful response contains every matching
transfer in the range, sorted deterministically and de-duplicated by the
provider-neutral transfer identity.

Internally, each eligible provider uses its own bounded maximum page and
ascending range filter. The first fresh window follows the configured
capability-aware priority and may use bounded fallback only until one provider
returns a valid response. That exact provider configuration is then pinned for
the whole scan: every split closed window is re-requested from that provider
only, and no provider cursor/page state is carried into the next window. This
prevents Alchemy page keys, Etherscan pages, and Moralis cursors (or different
provider snapshots) from being combined into one supposedly complete result.
If the pinned provider fails mid-scan, the operation raises
`BLOCK_RANGE_INCOMPLETE` rather than switching sources or returning partial
data. A successful result is returned only when the completed windows exactly
cover the requested interval; otherwise it raises a typed incomplete/stalled
error. An explicit record safety limit fails with `RANGE_RESULT_TOO_LARGE`
rather than truncating data.

The upgrade does not add global chain event scanning, normal transactions from
Alchemy asset transfers, arbitrary sing-box configuration, TUN/system routing,
unbounded memory, or a promise to evade API quotas or network policy.

For durable consumers, all address/token block-range methods accept an optional asynchronous
`onWindow` callback. It receives only a complete, inclusive, disjoint window
after the SDK has proved the provider response terminal. The callback is
awaited before the next window is requested, so a caller may atomically persist
the window and its own block checkpoint. In callback mode the final aggregate
response intentionally has an empty `items` array: completed records are not
retained in SDK memory. The callback never receives a provider cursor.

### 12.4 API-only ERC-20 historical snapshots

`client.token.getErc20TokenHoldings({ chain, address })` and
`client.token.getErc20BalancesAtBlock({ chain, address, blockNumber,
tokenAddresses })` are API-only Etherscan operations. The former returns a
paginated current holding list solely to discover contract addresses; the
latter requires that explicit list and returns raw balances at one exact
canonical block. Historical token snapshots are therefore a caller-owned
workflow, not a provider cursor or an implicit all-token scan. The fixed
Etherscan two-request-per-second limit is enforced in the adapter.

### API-only address range contracts

`client.address.getTransactionsByBlockRange()` completes one inclusive,
bounded transaction range. A full first page is discarded and its closed block
window is split before either child is retried; a terminal window is therefore
complete without exposing or persisting a provider cursor. It supports the
same optional complete-window callback and memory behavior as the ERC-20 range
operation. It uses indexed HTTP APIs only; no JSON-RPC method or provider RPC
proxy is part of this contract.

`client.chain.getLatestBlockNumber()` and
`client.chain.getBlockNumberByTimestamp()` use Etherscan's indexed block API.
Consumers apply a configured finality lag to the API height rather than
requesting an RPC `finalized` tag.

`client.address.getInternalNativeTransfersByBlockRange()` completes an
inclusive address/block interval through Etherscan's indexed
`account/txlistinternal` endpoint. It exposes canonical decimal-string value,
trace identity, status and provider provenance; provider pagination remains
internal and is bounded. Callback mode uses the same complete-window contract
and returns an empty aggregate `items` array after the callback is awaited. For
large callback ranges, the SDK applies a provider-independent 100,000-block
stream window guard before invoking the provider; this is an SDK memory guard,
not a business cursor or a provider page size.

`client.address.getBeaconWithdrawalsByBlockRange()` completes an inclusive
Ethereum address/block interval through Etherscan's indexed
`account/txsBeaconWithdrawal` endpoint. Withdrawal amounts retain their
provider unit explicitly (`amountDecimals: 9`, Gwei), so consumers cannot
mistake it for wei. Callback mode uses the same complete-window contract and
returns an empty aggregate `items` array after the callback is awaited. This
endpoint is unavailable on non-Ethereum chains.

## 13. v0.4 Upgrade: Chainlink Historical Prices via Ethereum Archive RPC and Multicall3

Version 0.4 is accepted by the owner on 2026-08-07. The full design,
verification evidence, algorithms, and implementation queue are in
[CHAINLINK_ETHEREUM_ARCHIVE_RPC_MULTICALL3_UPGRADE.md](./CHAINLINK_ETHEREUM_ARCHIVE_RPC_MULTICALL3_UPGRADE.md),
with endpoint/feed maintenance procedure in
[CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md](./CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md).

### 13.1 Product contract

`client.chainlink.getTokenPricesAtBlock({ blockNumber, signal })` is an
opt-in, direct-JSON-RPC operation, distinct from and never merged into
`client.token.getPriceHistory()`. It accepts one canonical non-negative
decimal-string Ethereum Mainnet block number and no token selector. It always
evaluates every enabled entry in a committed, versioned built-in Chainlink
Ethereum Mainnet feed manifest and returns the historical
`latestRoundData()` snapshot the Chainlink proxy considered latest as of that
exact block.

This is a Chainlink oracle-state read, not a market candle, trade price,
TWAP, or cross-provider consensus price. `updatedAt` can be earlier than the
requested block's timestamp because Chainlink feeds update on heartbeat and
deviation thresholds, not every block.

At least one successful feed read returns a result containing every feed
failure. Zero successful feeds rejects with
`CHAINLINK_PRICE_DATA_UNAVAILABLE`. Invalid input, no healthy RPC endpoint,
caller cancellation, and Multicall3 deployment-boundary violations reject the
whole operation; they are not reported as per-feed failures.

A companion public, provider-neutral operation
`client.rpc.multicallAtBlock({ chain, blockNumber, calls, signal })` exposes
the underlying exact-block Multicall3 `aggregate3` primitive independently of
Chainlink. It validates call target/data/id, batches deterministically under
a configured maximum, and returns per-call success/return data plus block and
endpoint provenance. It has no Chainlink-specific knowledge.

### 13.2 Configuration

`chainlink.enabled` opts into the feature; the SDK never contacts a public
Archive RPC unless a caller sets this. `chainlink.useBuiltinEthereumArchiveRpcs`
(default `true` when enabled) includes the maintained public endpoint
registry; `chainlink.rpcEndpoints` appends caller-supplied endpoints with
unique IDs. A Chainlink-only client configuration (no `providers`, no
`price`) is valid. Endpoint URLs, including caller-supplied ones, never
appear in errors, telemetry, or results; only the stable configured `id`
does.

### 13.3 Initialization and endpoint health

Client construction remains side-effect free. When Chainlink is enabled,
`await client.initialize(signal)` concurrently probes every configured
endpoint with a bound: `eth_chainId == 0x1`, a historical block header exists
at the configured probe block, and a historical Multicall3 `getBlockNumber()`
call decodes exactly that block. There is no background health timer; health
changes only through `initialize()` and passive real-request outcomes.

### 13.4 Endpoint selection, pinning, and reorg detection

Each `getTokenPricesAtBlock` or `multicallAtBlock` call builds an unbiased
random permutation of currently healthy endpoints through an injected random
source, pins the entire operation to the first endpoint in that permutation,
and never repeats an endpoint within one operation. A retryable
endpoint/archive failure discards all partial batch results and restarts the
whole operation on the next endpoint, bounded by `maxRpcAttempts` and
`totalTimeoutMs`. The requested block's header is read before and after all
Multicall batches; a changed hash discards the result as
`RPC_BLOCK_REORG_DETECTED` rather than returning inconsistent per-feed data.

### 13.5 Direct-only network boundary

Every JSON-RPC request this feature introduces is direct-only. It must never
use `ProxyPool`, the managed sing-box runtime, a configured HTTP(S) proxy, or
`requestPolicy.allowDirect`; Axios environment proxy discovery is explicitly
disabled at the transport boundary regardless of other client configuration.
Existing indexed REST and market-data proxy behavior is unaffected.

### 13.6 Feed registry

The built-in feed manifest is generated and committed, never fetched at
runtime. It includes only standard (non-SVR, non-shared-SVR) Ethereum
Mainnet Crypto/USD Reference Price feeds with a non-empty proxy address,
excluding hidden, deprecating (`shutdownDate` set), calculated,
exchange-rate-only, market-cap, Proof of Reserve, FX, commodity, equity,
rate, MVR, and Data Streams entries. `scripts/update-chainlink-ethereum-feeds.mjs`
is the only supported way to regenerate it; runtime code never fetches or
mutates it.

### 13.7 Acceptance criteria for v0.4

- A Chainlink-only client configuration is valid and makes no network call
  before `initialize()`.
- `initialize()` probes every configured endpoint concurrently, direct-only,
  even when HTTP/sing-box proxies and `allowDirect: false` are configured for
  unrelated operations.
- Random endpoint selection is unbiased, never repeats an endpoint per
  operation, and restarts entirely (not resumes) after an endpoint failure.
- A block below the verified Multicall3 deployment block
  (`14,353,601`) fails as `MULTICALL_NOT_DEPLOYED_AT_BLOCK` without an RPC
  call to that contract.
- `latestRoundData()` decoding enforces `answer > 0`, `updatedAt > 0`,
  `startedAt <= updatedAt <= blockTimestamp`, `answeredInRound >= roundId`,
  and a runtime/manifest `decimals()` match; violations are per-feed failures,
  never fabricated prices.
- At least one feed success returns a result with every failure reported;
  zero successes rejects with `CHAINLINK_PRICE_DATA_UNAVAILABLE`.
- No test in the default suite performs network I/O; live verification is
  opt-in and prints no endpoint URL, calldata, return data, or price.

## 14. v0.5 Upgrade: DeFi Exchange Rate Historical Snapshots

The v0.5 module adds `client.defi.getExchangeRatesAtBlock()`. It is an
explicit, read-only Archive RPC operation for Ethereum Mainnet (chain ID 1)
and Base Mainnet (chain ID 8453). A request selects one exact canonical block
and, by default, evaluates the committed built-in DeFi token registry for the
selected chain. A caller may pass a bounded `tokenIds` subset for targeted
reads.

The operation uses the existing direct-only Archive RPC + Multicall3 path. All
protocol calls for one request are encoded deterministically and sent with the
requested block as `blockTag`; endpoint selection is random among initialized
healthy public/caller endpoints, the whole operation is pinned to one endpoint,
and a retryable endpoint failure discards partial data and restarts on the next
untried endpoint. No proxy or environment proxy is used.

Each result is a Token -> one or more underlying-asset legs. A Uniswap-V2-like
LP token therefore returns both reserves as legs; it is never flattened into a
fake single price. All token and asset quantities, block numbers, rates, and
LP reserve values are decimal strings. A protocol call that reverts, is not yet
deployed at the requested block, or returns malformed data becomes a per-token
failure. At least one success returns a partial result; zero successes rejects
with `DEFI_EXCHANGE_RATE_DATA_UNAVAILABLE`.

The initial registry includes reviewed LST, lending, ERC-4626 vault, Compound
V2 lending, and Uniswap-V2-like LP adapters on Ethereum, plus Aave lending,
ERC-4626 vault, and LST/lending mappings on Base. The registry is committed
source, never fetched at runtime. Adding a protocol or chain requires a new
adapter/manifest entry, official-address and ABI verification, deterministic
fixtures, and the handoff procedure in
`docs/DEFI_EXCHANGE_RATE_SNAPSHOT/AI_CONTEXT.md`.

## 15. Blockscout provider extension

`blockscout` is a built-in indexed provider for Blockscout instances exposing
the Etherscan-compatible `/api` contract. It accepts the same address,
transaction, native-balance, ERC-20 transfer, page-size, direction, block-range,
and cursor inputs as the Etherscan adapter. Its public output uses the existing
domain models and reports `provider: "blockscout"`.

Each Blockscout configuration has an independent API-key pool and may provide a
network-specific `baseUrl`. With both Etherscan and Blockscout configured, the
central router and executor choose only capability-compatible candidates and
perform bounded key/provider fallback. A cursor is pinned to its original
provider configuration. The SDK does not infer Blockscout URLs for arbitrary
chains; a chain must declare `routes.blockscout.apiUrl`. A provider `baseUrl`
may override that declared route but does not broaden chain capability.

The adapter validates Etherscan-shaped envelopes at the provider boundary,
canonicalizes all integer quantities to decimal strings, filters transfer
direction in the SDK, and redacts credentials and upstream text from errors.
Blockscout v2 REST-only endpoints and operations without verified semantic
equivalence remain out of scope.
