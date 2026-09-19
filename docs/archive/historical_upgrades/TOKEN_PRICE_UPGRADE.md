# Token Price Aggregation Upgrade

Version: 0.2.0 proposal

Status: Implemented in the v0.2 working tree; pending focused commits and release decisions

Based on: v0.1.0 EVM Data SDK architecture

Last updated: 2026-08-05

## 1. Goal

Add a provider-aggregated token price history operation. The caller supplies a
token name or symbol and a time selector. The SDK queries four unauthenticated
market-data providers and maps their responses into one provider-neutral shape:

- Binance Spot API
- OKX Market API
- Coinbase Exchange API
- GeckoTerminal API

These providers do not require API keys for the endpoints in this proposal.
They still have IP, user-agent, and rate limits. A price request must therefore
use the existing explicit HTTP(S) transport and proxy policy, but must not use
the existing credential pools or rotate API keys.

| Provider | Price | Daily K-line/OHLCV | API key | Primary asset scope |
| --- | --- | --- | --- | --- |
| Binance | yes | yes, Spot `1d` klines | no | Exchange-listed assets |
| OKX | yes | yes, Spot `1D` candles | no | Exchange-listed assets |
| Coinbase | yes | yes, `86400` candles | no | Exchange-listed assets |
| GeckoTerminal | yes | yes, on-chain daily OHLCV | no | On-chain tokens and pools |

The adapter contract and default provider list are intentionally extensible:
adding a fifth source later should add one provider directory and one
configuration entry without changing the public result shape or the aggregator.

This document is an upgrade design only. It does not change v0.1 source code,
the v0.1 accepted specification, or release status.

## 2. Product Contract

### 2.1 Public call

The price operation belongs to the token namespace:

```ts
const result = await client.token.getPriceHistory({
  token: "ETH",
  range: { kind: "latest", days: 30 },
});

const oneDay = await client.token.getPriceHistory({
  token: "ETH",
  range: { kind: "date", date: "2026-07-01" },
});

const period = await client.token.getPriceHistory({
  token: "ETH",
  range: {
    kind: "between",
    startDate: "2026-07-01",
    endDate: "2026-07-31",
  },
});
```

`token` is the only required business input. Dates are calendar dates in UTC,
formatted as `YYYY-MM-DD`. The initial implementation uses a daily interval
(`1d`) for every provider.

An optional `getPrice` alias may be added later, but the first implementation
should expose one unambiguous method, `getPriceHistory`, for both a single date
and a time series.

### 2.2 Time selectors

```ts
type TokenPriceRange =
  | { kind: "latest"; days: number }       // inclusive, 1..365
  | { kind: "date"; date: string }         // exactly one UTC day
  | { kind: "between"; startDate: string; endDate: string }; // inclusive
```

Rules:

1. `latest: { days: 30 }` means the current UTC date and the preceding 29
   calendar dates, inclusive.
2. `date` means `[00:00:00, 24:00:00)` UTC for that date.
3. `between` is inclusive at both ends and must contain no more than 366
   calendar dates in v0.2.
4. A date may not be more than 10 years in the past unless a provider later
   documents a stricter retention limit; the adapter reports the provider
   limitation rather than fabricating a value.
5. A requested date may not be in the future. `startDate` must not be after
   `endDate`. Invalid dates, timestamps, or ranges fail before any network
   request.
6. The canonical `price` for a daily candle is its `close` value. Open, high,
   low, close, and volume remain available for consumers that need them.
7. The current UTC day is an unfinished candle. `isFinal` is `false` when the
   provider can establish this, and historical completed days are `true`.
   The SDK never treats an unfinished close as a completed daily close.

No local timezone option is introduced in v0.2. Supporting a timezone would
change candle boundaries and must be a separate decision.

### 2.3 Token input and identity

Input is trimmed and normalized for matching, but the original value is kept in
the response. The resolver accepts common symbols (`ETH`, `BTC`) and exact
common names (`Ethereum`, `Bitcoin`) through a small built-in alias table. An
application may provide explicit aliases in configuration for project tokens.

The resolver must not silently select an arbitrary fuzzy match:

- Prefer an exact symbol match.
- Then prefer an exact token-name match.
- Then prefer a unique case-insensitive prefix match.
- If more than one eligible market remains at the same decision level, that
  provider returns `TOKEN_AMBIGUOUS`.
- If no eligible market remains, that provider returns `TOKEN_NOT_FOUND` or
  `MARKET_NOT_FOUND` as appropriate.

The exchange providers resolve a spot market independently. GeckoTerminal must
resolve a network, token contract, and pool because a name alone is not a
globally unique on-chain identity. The GeckoTerminal resolver searches the
configured EVM networks, scores exact symbol/name matches, then uses liquidity
and recent volume as deterministic tie breakers. Its selected `network`,
`tokenAddress`, `poolAddress`, symbol, name, and selection reason are returned
in provider metadata.

This limitation is intentional: an exchange symbol and an on-chain contract
with the same symbol are not asserted to be the same asset. A future request
shape may add `chain` and `contractAddress` to make GeckoTerminal selection
exact; those fields are not required in v0.2.

### 2.4 Quote assets and market semantics

The public response always exposes the quote actually used by each provider:

- Binance: `BASEUSDT`, Spot, with `quoteAsset: "USDT"`.
- OKX: `BASE-USDT`, Spot, with `quoteAsset: "USDT"`.
- Coinbase: `BASE-USD`, Exchange Spot, with `quoteAsset: "USD"`.
- GeckoTerminal: provider's USD OHLCV endpoint, with `quoteAsset: "USD"`.

USDT is not silently converted to USD. Consumers can compare the values while
still seeing the source quote asset. A future FX/quote-normalization feature
must be explicit and cannot be hidden in this operation.

For exchange metadata, select only active Spot products. Do not use futures,
perpetual swaps, leveraged tokens, inactive products, or a market selected only
because its name contains the input string. If the preferred quote is absent,
the provider fails with `MARKET_NOT_FOUND` in v0.2 rather than choosing a
different quote without telling the caller.

## 3. Unified Return Contract

Every successful provider uses the same `TokenPriceProviderResult` shape. The
aggregator keeps only successful results in `results` and records omitted
providers in `failures` so partial success is visible and machine-readable.

```ts
type TokenPriceProviderName =
  | "binance"
  | "okx"
  | "coinbase"
  | "geckoterminal";

interface TokenPricePoint {
  /** UTC calendar date, for example 2026-07-01. */
  date: string;
  timestamp: string;
  open: string;
  high: string;
  low: string;
  close: string;
  /** Always equal to close for the daily operation. */
  price: string;
  volume: string | null;
  isFinal: boolean | null;
}

interface TokenPriceProviderResult {
  provider: TokenPriceProviderName;
  status: "success";
  token: {
    input: string;
    normalized: string;
    symbol: string;
    name: string | null;
  };
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
  requestedRange: {
    kind: "latest" | "date" | "between";
    startDate: string;
    endDate: string;
  };
  points: TokenPricePoint[];
  missingDates: string[];
}

interface TokenPriceProviderFailure {
  provider: TokenPriceProviderName;
  code:
    | "TOKEN_NOT_FOUND"
    | "TOKEN_AMBIGUOUS"
    | "MARKET_NOT_FOUND"
    | "HISTORY_NOT_AVAILABLE"
    | "RATE_LIMITED"
    | "REQUEST_TIMEOUT"
    | "NETWORK_ERROR"
    | "PROXY_ERROR"
    | "INVALID_PROVIDER_RESPONSE"
    | "PROVIDER_UNAVAILABLE";
  retryable: boolean;
  message: string;
}

interface TokenPriceAggregationResult {
  query: {
    tokenInput: string;
    normalizedToken: string;
    interval: "1d";
    timezone: "UTC";
    range: TokenPriceRange;
    resolvedStartDate: string;
    resolvedEndDate: string;
  };
  /** Deterministic order: configured order, or Binance/OKX/Coinbase/GeckoTerminal. */
  results: TokenPriceProviderResult[];
  failures: TokenPriceProviderFailure[];
  summary: {
    requestedProviders: number;
    succeededProviders: number;
    failedProviders: number;
    partial: boolean;
  };
}
```

All prices and volumes are decimal strings. JavaScript `number` is not safe for
price or volume values with arbitrary precision and must not appear in the
public price model. `missingDates` is explicit; the adapter must not fill a
missing candle with zero or with the previous close.

### 3.1 Partial-success policy

All enabled providers are attempted independently and concurrently. One
provider failure does not cancel the other three.

- At least one successful provider: resolve `TokenPriceAggregationResult`, set
  `summary.partial` to `true` when any provider failed, and include every
  failure in `failures`.
- All four successful: `failures` is empty and `partial` is `false`.
- No successful provider: reject with aggregate `EvmDataError` code
  `PRICE_DATA_UNAVAILABLE`; its sanitized message may summarize provider error
  codes but must not contain URLs, headers, proxy credentials, or response
  bodies.
- Invalid input, no configured price providers, or a disallowed route remains a
  normal typed error and is not converted into a misleading partial success.

For example, an ETH request can resolve with three entries in `results` and one
entry in `failures` when Coinbase is rate-limited. This is a successful partial
response; callers do not need to special-case a missing array element or parse
an upstream error payload.

The initial operation has no public pagination cursor. Adapters internally
chunk a range when an upstream candle endpoint has a small limit, then merge,
deduplicate by UTC date, and sort ascending before returning.

## 4. Configuration and Routing

Price providers are independent from Etherscan, Alchemy, and Moralis provider
credentials. They have no `apiKeys` field and the SDK must not read any price
credential from the environment.

Suggested additive configuration:

```ts
interface PriceProviderConfiguration {
  readonly kind: "binance" | "okx" | "coinbase" | "geckoterminal";
  readonly baseUrl?: string; // HTTPS production default; test override only
  readonly enabled?: boolean;
}

interface PriceConfiguration {
  readonly providers?: readonly PriceProviderConfiguration[];
  readonly routeMode?: "direct" | "proxy-only";
  readonly attemptTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxProviderConcurrency?: number; // default 4, max 4 in v0.2
  readonly tokenAliases?: Readonly<Record<string, string>>;
  readonly geckoNetworks?: readonly string[]; // defaults to the built-in EVM network map
}
```

The existing `proxies` array is reused. `routeMode` is fixed for the complete
request:

- `direct` (default): every price attempt explicitly uses the local route with
  Axios `proxy: false`; configured proxies are not consulted and environment
  proxy variables cannot change behavior.
- `proxy-only`: every price attempt must use an explicitly configured HTTP(S)
  proxy. If no proxy is available, the provider fails with `PROXY_ERROR`; the
  executor never falls back to the local route.

There is no API-key rotation. A proxy may be leased using the existing
transport-level proxy pool when several proxies are configured, but a
proxy-only request may never silently become direct. Provider and proxy
failures use the existing bounded retry/deadline policy; no background health
probe or unbounded retry is allowed.

If `price.providers` is omitted, all four providers are enabled in this order:
Binance, OKX, Coinbase, GeckoTerminal. Supplying the list explicitly enables a
subset and fixes the output order. `geckoNetworks` is an optional list of
GeckoTerminal network identifiers; when omitted, the implementation uses the
built-in mapping for Ethereum, BNB Smart Chain, Polygon, Arbitrum, Base, and
Optimism. This mapping is only for name resolution and does not change the
blockchain address APIs.

For backwards compatibility, an existing client may configure blockchain
providers and price providers together. The implementation should also permit
a price-only client by making the two provider groups independently optional,
while requiring at least one usable provider across both groups. Existing v0.1
configurations and behavior must remain valid.

## 5. Provider Adapter Contract

Price adapters are separate from `DataProviderAdapter`: they do not require a
chain, credential lease, or provider-pinned blockchain cursor.

```ts
interface TokenPriceProviderAdapter {
  readonly name: TokenPriceProviderName;

  supports(request: NormalizedTokenPriceRequest): boolean;

  getPriceHistory(
    request: NormalizedTokenPriceRequest,
    context: PriceProviderAttemptContext,
  ): Promise<TokenPriceProviderResult>;
}

interface PriceProviderAttemptContext {
  readonly proxy: ProxyLease | null;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
  readonly correlationId: string;
}
```

An adapter performs one bounded upstream attempt. It owns URL/query encoding,
provider-local response schemas, market resolution, candle pagination/chunking,
error classification, and mapping. It must not retry, call another provider,
or select a credential. Shared orchestration belongs to the price executor.

The aggregator uses `Promise.allSettled` or an equivalent bounded scheduler,
preserves configured provider order in the final result, and uses the same
`HttpTransport`, redaction, abort, timeout, and observation boundaries already
used by v0.1.

## 6. Provider Integrations

The following are implementation baselines. Before coding, recheck each
provider's official documentation, limits, response fields, and endpoint
retention rules; record any change in `docs/INTEGRATIONS.md`.

### 6.1 Binance

- Production base: `https://api.binance.com`.
- Market metadata: public Spot exchange-information endpoint to resolve and
  validate `BASEUSDT` and its trading status.
- Daily candles: Spot `klines`, `interval=1d`, with UTC `startTime`, `endTime`,
  and bounded `limit`.
- The Binance row is mapped from candle open time, open, high, low, close, and
  quote volume. Candle arrays are untrusted and require a provider-local
  schema.
- A `429` or documented ban/rate-limit response is retryable only within the
  aggregate deadline. Do not treat a market-not-found response as transient.

Official references:

- https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints#klinecandlestick-data
- https://developers.binance.com/docs/binance-spot-api-docs/rest-api/general-endpoints#exchange-information

### 6.2 OKX

- Production base: `https://www.okx.com`.
- Resolve an active Spot `BASE-USDT` instrument from public instruments
  metadata; do not select swaps or futures.
- Use the public historical candles endpoint for the bounded daily range. Use
  `bar=1Dutc` rather than generic `1D`: the latter uses the exchange's
  non-UTC day boundary, while the public SDK contract requires UTC dates.
- OKX commonly returns newest-first rows. The mapper must normalize to
  ascending `date` order and deduplicate by date.
- Preserve the provider's candle completion flag when available; otherwise use
  the date boundary to set `isFinal`.

Official references:

- https://www.okx.com/docs-v5/en/#rest-api-market-data-get-candlesticks
- https://www.okx.com/docs-v5/en/#rest-api-public-data-get-instruments

### 6.3 Coinbase Exchange

- Production base: `https://api.exchange.coinbase.com`.
- Resolve an active `BASE-USD` Spot product from the public products endpoint.
- Use the public product candles endpoint with `granularity=86400` and UTC
  `start`/`end` values. Coinbase imposes a candle-count limit, so a range may
  need bounded sequential chunks.
- Coinbase candle rows are typically `[time, low, high, open, close, volume]`;
  validate the array length and map fields by position inside the adapter only.
- A product not listed as active is `MARKET_NOT_FOUND`, not a generic network
  failure.

Official references:

- https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproducts
- https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles

### 6.4 GeckoTerminal

- Production base: `https://api.geckoterminal.com/api/v2`.
- Search public pools by the supplied name/symbol, restricted to configured
  EVM networks where possible.
- Select a deterministic token/pool candidate using exact symbol/name match,
  then liquidity and volume tie breakers. Never return a pool address without
  returning its network and token address.
- Query the selected pool's daily OHLCV endpoint and map the close as `price`.
- GeckoTerminal is the primary on-chain source in this set, but a name-only
  lookup can still resolve the wrong similarly named token. Return resolution
  metadata and expose `TOKEN_AMBIGUOUS` when deterministic selection is not
  safe.
- Public API rate limits and maximum candle windows must be honored. A later
  implementation may add explicit contract-address input for exact resolution.

Official references:

- https://www.geckoterminal.com/dex-api
- https://apiguide.geckoterminal.com/

## 7. Failure, Retry, and Redaction Rules

Add these stable domain codes without changing the meaning of existing v0.1
codes:

```ts
type PriceErrorCode =
  | "TOKEN_NOT_FOUND"
  | "TOKEN_AMBIGUOUS"
  | "MARKET_NOT_FOUND"
  | "HISTORY_NOT_AVAILABLE"
  | "PRICE_DATA_UNAVAILABLE";
```

Provider-level errors are normalized into the existing retryable classes where
possible (`RATE_LIMITED`, `REQUEST_TIMEOUT`, `NETWORK_ERROR`, `PROXY_ERROR`,
`INVALID_PROVIDER_RESPONSE`, `PROVIDER_UNAVAILABLE`) and the price-specific
codes above where they are semantic failures.

Retry only bounded transient failures: network errors, timeouts, HTTP 429,
selected 5xx responses, and documented provider-busy responses. Honor
`Retry-After` where present. Do not retry invalid token names, ambiguous
resolution, inactive markets, malformed caller input, or a missing proxy in
proxy-only mode. Every provider shares the aggregate deadline but a failed
provider cannot consume another provider's entire budget.

The following must never be observable in errors, logs, telemetry, fixtures,
or returned cursors (there are no price cursors in v0.2): API keys, even though
none are expected; proxy userinfo; full authenticated URLs; authorization
headers; raw provider response bodies; and unbounded search/candle payloads.

## 8. Architecture Changes

Add responsibility-specific modules rather than modifying blockchain adapters:

```text
src/
├── services/
│   └── TokenService.ts                 # add getPriceHistory()
├── domain/
│   ├── priceModels.ts
│   ├── priceOperations.ts
│   └── errors.ts                        # price error codes
├── price/
│   ├── TokenPriceProviderAdapter.ts
│   ├── PriceProviderRouter.ts
│   ├── PriceRequestExecutor.ts
│   └── TokenPriceAggregator.ts
└── providers/price/
    ├── binance/
    ├── okx/
    ├── coinbase/
    └── geckoterminal/
```

`HttpTransport`, `ProxyPool`, retry policy primitives, clock, cancellation,
and redaction may be reused. The blockchain `RequestExecutor` and its
credential pools must not be forced to understand a credential-free request.
Provider directories must not import each other.

The public operation name is `getPriceHistory`; telemetry uses the same
operation name and `chainId: null`. Price provider names remain distinguishable
from Etherscan, Alchemy, and Moralis in observations and results.

## 9. Validation and Security Acceptance Criteria

Before implementation is considered complete:

- Four provider adapters can map fixture responses for latest-30-day, one-day,
  and inclusive date-range requests into the exact same point shape.
- No price configuration accepts or requires an API key. No SDK code reads
  price credentials from process environment.
- Direct mode sends `proxy: false` and ignores ambient proxy environment
  variables. Proxy-only mode never attempts direct access.
- All enabled providers are attempted concurrently, output order is stable,
  one failure does not suppress other successes, and zero successes produce
  `PRICE_DATA_UNAVAILABLE`.
- A partial response contains successful results plus sanitized per-provider
  failures; it does not quietly drop a provider.
- Dates are UTC, inclusive as documented, sorted ascending, deduplicated, and
  represented as strings. Missing dates are explicit and never filled with
  fabricated prices.
- Exchange resolution excludes futures/swaps/inactive products and does not
  silently switch quote assets.
- GeckoTerminal returns network/token/pool resolution metadata and refuses an
  unsafe ambiguous name match.
- Range chunking respects each provider's documented candle limit and remains
  bounded by the total deadline and maximum request count.
- Malformed provider payloads, HTTP 200 error envelopes, 429s, 5xx responses,
  timeouts, aborts, and proxy failures have deterministic tests.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and
  `pnpm test:package` remain green; existing v0.1 tests are unchanged in
  meaning.

## 10. Ordered Terra Work Packages

Work on one package at a time and stop if its acceptance criteria fail.

### Price-0: Approve and record the upgrade

Update the relevant baseline documents after owner approval: provider links and
limits in `docs/INTEGRATIONS.md`, public behavior in `docs/SPEC.md`, module
boundaries in `docs/ARCHITECTURE.md`, decisions in `docs/DECISIONS.md`, and
the handoff in `docs/NEXT_SESSION.md`.

### Price-1: Domain and configuration

Add normalized price requests, range validation, price models, configuration
schema, provider names, error codes, and telemetry operation typing. Add tests
for UTC boundaries, aliases, date limits, quote rules, and price-only client
configuration.

### Price-2: Credential-free price execution

Implement the price adapter contract, deterministic provider ordering, bounded
parallel execution, fixed direct/proxy-only route policy, cancellation,
timeouts, retry classification, and partial/all-failed aggregation. Reuse
transport and redaction boundaries without adding a generic manager module.

### Price-3: Binance and OKX adapters

Implement public market resolution, daily candle requests, provider schemas,
range chunking, mapping, and fixture tests. Confirm Spot-only and USDT quote
selection.

### Price-4: Coinbase and GeckoTerminal adapters

Implement public product/pool resolution, daily OHLCV mapping, Gecko network and
contract metadata, ambiguity handling, range chunking, and fixture tests.

### Price-5: Public composition and package verification

Add `client.token.getPriceHistory`, compose configured price providers without
changing existing services, update README/examples, run the full check and
package smoke tests, then update the handoff document.

## 11. Explicit Non-goals for v0.2

- No API-key management or credential rotation for price providers.
- No futures, perpetual swaps, leveraged products, or cross-quote FX
  conversion.
- No claim that an exchange symbol and a GeckoTerminal contract are the same
  asset when only a name was supplied.
- No arbitrary fuzzy token search that can silently return a wrong market.
- No browser-only transport or hidden server-side proxy.
- No persistent cache, background polling, websocket stream, alerts, or
  real-time tick price operation.
- No public pagination cursor; only bounded internal candle chunking.
- No automatic route-mode switching from proxy-only to direct.
- No fabricated values for missing candles or failed providers.
