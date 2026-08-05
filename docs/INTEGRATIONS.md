# External Integrations

Version: 0.2.0

Status: Accepted for v0.1 implementation

Last verified against official sources: 2026-08-05

External APIs and package behavior change independently of this SDK. Before changing an adapter or upgrading a major dependency, recheck the linked official documentation and update this file first.

## 0. Public token price providers

The v0.2 price operation uses unauthenticated public endpoints only. The SDK does not read API keys or environment values for these adapters, does not run a background probe, and does not use WebSockets or a cache. All adapters request daily OHLCV, preserve the provider quote asset, and return decimal strings. A direct price request explicitly disables Axios environment-proxy discovery; proxy-only accepts only caller-configured HTTP(S) proxies.

### Binance Spot API

Official documentation:

- Exchange information: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/general-endpoints#exchange-information
- Kline/candlestick data: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data-endpoints#klinecandlestick-data

SDK endpoints: https://api.binance.com/api/v3/exchangeInfo and /api/v3/klines.

Important notes: The adapter resolves only an active Spot BASEUSDT market and requests interval=1d. Binance accepts up to 1,000 klines per request, so the adapter chunks larger internal ranges at 1,000 calendar days (the public v0.2 maximum is 366). It maps open time, open, high, low, close, and volume; price is close. HTTP 418/429 is rate-limited and retryable within the bounded price attempt policy.

### OKX Market API

Official documentation:

- Instruments: https://www.okx.com/docs-v5/en/#rest-api-public-data-get-instruments
- History candles: https://www.okx.com/docs-v5/en/#rest-api-market-data-get-history-candlesticks

SDK endpoints: https://www.okx.com/api/v5/public/instruments and /api/v5/market/history-candles.

Important notes: The adapter selects only a live instType=SPOT BASE-USDT instrument. It requests bar=1Dutc, not generic 1D, because the public SDK contract has UTC calendar boundaries. OKX rows are newest-first and include a completion flag; the mapper deduplicates and returns ascending UTC dates. The adapter uses bounded 100-day chunks so the source limit cannot silently truncate a public range.

### Coinbase Exchange API

Official documentation:

- Products: https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getallproducts
- Product candles: https://docs.cdp.coinbase.com/exchange/reference/exchangerestapi_getproductcandles

SDK endpoints: https://api.exchange.coinbase.com/products and /products/{BASE-USD}/candles.

Important notes: Only an enabled BASE-USD product is selected. Candles use granularity=86400; Coinbase documents a maximum of 300 data points per request, so the adapter issues 300-day sequential UTC chunks and de-duplicates their inclusive boundary. Candle order is [time, low, high, open, close, volume]. Historical output can be incomplete when no ticks exist; missing calendar days are surfaced in missingDates.

### GeckoTerminal API

Official documentation:

- API guide: https://apiguide.geckoterminal.com/
- Search pools: https://apiguide.geckoterminal.com/docs/api-reference/pools/search-pools
- Pool OHLCV: https://apiguide.geckoterminal.com/docs/api-reference/pools/ohlcv-chart

SDK endpoint base: https://api.geckoterminal.com/api/v2.

Important notes: Name-only input is resolved from search-pool relationships within configured networks. The resolver prefers exact symbol, then exact name, then a unique prefix; equal-rank different network/contract identities produce TOKEN_AMBIGUOUS. It picks a pool for one resolved token deterministically by liquidity, 24-hour volume, then address, but exposes network, token contract, pool, and selected token side instead of asserting exchange/on-chain asset equivalence. The OHLCV request explicitly uses currency=usd and token=base|quote, so a matched quote-side token does not accidentally return the base token's price.

## 1. Etherscan

**External project:** Etherscan API

**Selected version:** API V2

**Official documentation:**

- Introduction: https://docs.etherscan.io/introduction
- V2 migration: https://docs.etherscan.io/v2-migration
- Supported chains: https://docs.etherscan.io/supported-chains
- Chain list endpoint: https://docs.etherscan.io/api-reference/endpoint/chainlist
- Rate limits: https://docs.etherscan.io/resources/rate-limits
- Common errors: https://docs.etherscan.io/resources/common-error-messages
- Transactions: https://docs.etherscan.io/api-reference/endpoint/txlist
- Native balance: https://docs.etherscan.io/api-reference/endpoint/balance
- ERC-20 transfers: https://docs.etherscan.io/api-reference/endpoint/tokentx

**Purpose in the SDK:** normal address transactions, latest native balance, and ERC-20 transfers.

**Base endpoint:** `https://api.etherscan.io/v2/api`

**Authentication:** Etherscan API key in the `apikey` query parameter.

**Important notes:**

- Etherscan API V1 was deprecated on 2025-08-15. Do not call legacy `api.etherscan.io/api`, `api.bscscan.com/api`, `api.polygonscan.com/api`, or other explorer-specific V1 endpoints.
- One Etherscan V2 key is used with the unified endpoint. The target network is selected with a decimal `chainid` query parameter, such as `1` for Ethereum and `56` for BNB Smart Chain.
- Explorer websites remain chain-specific, but website domains are not the V2 API routing mechanism.
- At verification time, the free tier allowed 3 calls/second and 100,000 calls/day on selected chains. Paid tiers differ. These values are documentation, not hardcoded SDK assumptions.
- BNB Smart Chain, Base, and OP were marked unavailable on the free tier at verification time. A supported chain can still produce a plan restriction.
- Some chains have shared community quotas. Rotating caller keys or proxies does not reliably or appropriately bypass an account/chain quota.
- Etherscan can return HTTP 200 with logical errors in `status`, `message`, and `result`. Endpoint-specific no-result responses must be separated from failures.
- Etherscan recommends page/offset and bounded block ranges. Large ranges may return query timeouts.
- The SDK adapter sends `page`, `offset`, `sort`, and optional `startblock`/`endblock` on every list attempt; continuation state contains only the next page number.
- ERC-20 direction filtering is applied after the provider page is mapped. Provider page fullness, rather than filtered item count, determines whether another page is requested.
- Successful payloads are validated with provider-local schemas. Missing optional fields map to `null`; decimal quantities are canonicalized and timestamps are converted from Unix seconds to ISO UTC.
- Logical errors are classified without including the authenticated request URL: invalid keys, plan restrictions, unsupported chains, rate limits, and provider busy/timeout responses remain distinct.
- The supported-chain page announced Moonbeam, Moonriver, and Moonbase API deprecation effective 2026-07-31. They are not v0.1 built-ins. Gnosis free access was announced to move to paid plans on 2026-09-01.
- Redact `apikey` and the full authenticated URL from every observable error and event.

## 2. Alchemy

**External project:** Alchemy Chain APIs and Transfers API

**Selected version:** Ethereum JSON-RPC plus current `alchemy_getAssetTransfers`; Alchemy does not publish one global API version for these methods.

**Official documentation:**

- Chain documentation index: https://www.alchemy.com/docs/chains/llms.txt
- `eth_getBalance`: https://www.alchemy.com/docs/chains/ethereum/ethereum-api-endpoints/eth-get-balance
- Transfers API overview: https://www.alchemy.com/docs/reference/transfers-api-quickstart
- `alchemy_getAssetTransfers`: https://www.alchemy.com/docs/data/transfers-api/transfers-endpoints/alchemy-get-asset-transfers
- Throughput and retries: https://www.alchemy.com/docs/reference/throughput
- Compute units: https://www.alchemy.com/docs/reference/compute-units
- Best practices: https://www.alchemy.com/docs/best-practices-when-using-alchemy
- Header authentication: https://www.alchemy.com/docs/how-to-use-api-keys-in-http-headers

**Purpose in the SDK:** latest native balance and directional ERC-20 transfer queries.

**Base endpoint:** network-specific, for example `https://eth-mainnet.g.alchemy.com/v2`.

**Authentication:** `Authorization: Bearer <api-key>` header. Header authentication is selected to keep keys out of request URLs.

**Important notes:**

- Network hosts differ by chain. The chain registry owns the mapping, for example `eth-mainnet`, `bnb-mainnet`, `polygon-mainnet`, `arb-mainnet`, `base-mainnet`, and `opt-mainnet` where supported.
- `eth_getBalance` returns a hexadecimal wei quantity and costs compute units.
- `alchemy_getAssetTransfers` returns asset transfers and an optional `pageKey`; it is not a complete normal transaction history.
- A wallet-wide both-directions transfer query requires two ordered streams (`fromAddress` and `toAddress`). Correct bounded merging needs additional cursor design, so Alchemy supports only explicit incoming or outgoing ERC-20 requests in v0.1.
- Internal transfer data and metadata support vary by chain. v0.1 uses only the ERC-20 category needed by its contract.
- At verification time, throughput was account-level CU/s over a 10-second rolling token-bucket window. Different methods have different CU weights; `alchemy_getAssetTransfers` documented 120 CUs and `eth_getBalance` documented 20 CUs.
- HTTP 429 and JSON-RPC error envelopes must both be classified. Honor `Retry-After` when present and use bounded exponential backoff with jitter.
- Alchemy recommends HTTPS for request/response methods and batches below 50. v0.1 does not batch provider calls.
- Authorization headers and any legacy URL key form must be redacted.
- The adapter sends JSON-RPC requests to the registry's network-specific `/v2` endpoint with `Authorization: Bearer`; API keys never enter endpoint URLs. It maps `eth_getBalance` hexadecimal wei values and directional `alchemy_getAssetTransfers` ERC-20 pages with `pageKey` continuation.

## 3. Moralis

**External project:** Moralis Data API

**Selected version:** EVM Data API v2.2

**Official documentation:**

- Data API overview: https://docs.moralis.com/data-api/overview
- EVM supported chains: https://docs.moralis.com/data-api/supported-chains
- Raw wallet transactions: https://docs.moralis.com/data-api/evm/wallet/wallet-transactions
- Native balance: https://docs.moralis.com/data-api/evm/wallet/native-balance
- ERC-20 transfers: https://docs.moralis.com/data-api/evm/wallet/token-transfers
- Pagination: https://docs.moralis.com/data-api/resources/pagination
- Rate limits: https://docs.moralis.com/data-api/resources/rate-limits
- Response codes: https://docs.moralis.com/data-api/resources/response-codes

**Purpose in the SDK:** normal address transactions, latest native balance, and ERC-20 transfers.

**Base endpoint:** `https://deep-index.moralis.io/api/v2.2`

**Authentication:** `X-API-Key` header.

**Important notes:**

- Chain routing uses Moralis chain values supplied by the SDK chain registry. Feature support varies by chain even when the chain appears in a general support list.
- The raw wallet transactions endpoint `GET /{address}` aligns with v0.1 transaction semantics better than the enriched `GET /wallets/{address}/history` activity feed.
- Native balance is `GET /{address}/balance`; ERC-20 wallet transfers are `GET /{address}/erc20/transfers`.
- Moralis list endpoints use cursor pagination. Documentation states that limit is set on the initial request and cannot change mid-pagination, and that cursors represent a stable snapshot where supported.
- At verification time, rate limits used a rolling four-second window. Published request throughput was 40 requests/s for Free and Starter, 80 for Pro, 200 for Business, and custom for Enterprise. Plans and endpoint compute costs may change and are not hardcoded defaults.
- HTTP 400, 401, 404, 425, 429, and 500 have conventional meanings, but 404 must be interpreted per endpoint rather than globally converted to an empty result. Moralis 425 responses are treated as transient provider unavailability and remain retryable.
- Prefer raw integer fields over formatted decimal fields when mapping public amounts.
- Redact `X-API-Key` and provider cursor values from observations.
- The adapter uses the raw transaction endpoint, native balance endpoint, and ERC-20 transfer endpoint with provider-local schemas. Its cursor is wrapped in the SDK cursor and is never exposed directly.

## 4. Axios

**External project:** Axios

**Selected version:** 1.19.0

**Official documentation:**

- https://axios-http.com/docs/intro
- Request configuration and proxy behavior: https://axios-http.com/docs/req_config

**Purpose in the SDK:** cancellable HTTP transport, timeouts, response headers, JSON bodies, and Node.js HTTP(S) proxy configuration.

**Important notes:**

- Retries are implemented by the SDK, not by an Axios interceptor or `axios-retry`.
- Configure `validateStatus` so provider adapters can inspect non-2xx bodies.
- Axios can read `http_proxy`, `https_proxy`, and `no_proxy` environment variables. The SDK requires explicit proxy behavior, so set `proxy: false` for direct attempts and supply an explicit parsed proxy object only for a selected proxy lease.
- Limit v0.1 proxy protocols to HTTP and HTTPS. SOCKS requires a separate reviewed transport decision.
- Prevent redirects from forwarding or reinjecting provider authorization to an untrusted or downgraded destination. Prefer disabling redirects unless a provider has a documented need.
- Do not pass untrusted Axios configuration through public APIs. In particular, do not expose `socketPath`, arbitrary agents, or header overrides.

## 5. Zod

**External project:** Zod

**Selected version:** 4.4.3

**Official documentation:** https://zod.dev/

**Purpose in the SDK:** runtime validation for client configuration, public requests, cursors, and untrusted provider response envelopes.

**Important notes:** Provider schemas are private. Public TypeScript types should have one clear ownership source; do not create drift between hand-written interfaces and inferred schemas.

## 6. TypeScript

**External project:** TypeScript

**Selected version:** 7.0.2, subject to toolchain compatibility verification before bootstrap

**Official documentation:** https://www.typescriptlang.org/docs/

**Purpose in the SDK:** implementation language and declaration generation.

**Important notes:** Strict flags in `BUILD.md` are required. Do not weaken compiler settings to accommodate provider payloads; validate unknown data at boundaries.

## 7. tsup

**External project:** tsup

**Selected version:** 8.5.1

**Official documentation:** https://tsup.egoist.dev/

**Purpose in the SDK:** ESM, CommonJS, declaration, and source map builds.

**Important notes:** The ESM/CJS bundling path in `tsup@8.5.1` works with TypeScript 7. Its declaration path is not compatible: the bundled `rollup-plugin-dts@6.1.1` crashes against TypeScript 7's compiler API. Work Package 1 disables tsup declaration bundling and invokes TypeScript 7 with `emitDeclarationOnly` after the JavaScript build. Recheck this workaround before upgrading either tool.

## 8. Vitest

**External project:** Vitest

**Selected version:** 4.1.10

**Official documentation:** https://vitest.dev/guide/

**Purpose in the SDK:** deterministic unit, adapter contract, execution integration, and live test orchestration.

**Important notes:** Default tests must not use the network or real time. Live tests are separately selected and credential-gated.

## 9. ESLint

**External project:** ESLint

**Selected version:** 10.8.0

**Official documentation:** https://eslint.org/docs/latest/

**Purpose in the SDK:** static analysis with flat configuration.

**Important notes:** The checked `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin` 8.66.0 peer ranges are `typescript >=4.8.4 <6.1.0`; with TypeScript 7.0.2 they fail at startup with `typescript-eslint does not support TS 7.0`. Work Package 1 therefore uses ESLint 10 flat config for JavaScript package tooling and smoke tests, while strict `tsc` validates TypeScript source. Do not add a TypeScript ESLint parser until it supports the selected TypeScript major.

## 10. Changesets

**External project:** Changesets

**Selected version:** 2.31.1

**Official documentation:** https://github.com/changesets/changesets/tree/main/docs

**Purpose in the SDK:** npm package versioning and changelog entries.

**Important notes:** Publishing remains blocked until package ownership, package name, access level, license, and CI provenance are approved.

## 11. pnpm

**External project:** pnpm

**Selected version:** 11.20.0

**Official documentation:** https://pnpm.io/

**Purpose in the SDK:** deterministic dependency management and scripts.

**Important notes:** Record the version in `packageManager` and commit `pnpm-lock.yaml`. CI uses `--frozen-lockfile`. pnpm 11.20.0 moved lifecycle approval to `pnpm-workspace.yaml`; this repository allows only `esbuild`, which tsup requires.

## 12. Node.js

**External project:** Node.js

**Selected version:** 24 LTS development baseline

**Official documentation:** https://nodejs.org/docs/latest-v24.x/api/

**Purpose in the SDK:** runtime, test runtime, and package build environment.

**Important notes:** HTTP(S) proxies are a Node-only SDK feature. Do not claim browser support in v0.1. Test any additional active LTS line before listing it in `engines`.

## 13. Node Type Definitions

**External project:** DefinitelyTyped Node.js declarations

**Selected version:** `@types/node` 24.0.0

**Official documentation:** https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node

**Purpose in the SDK:** Type declarations for Node.js APIs used by build configuration, package smoke tests, and later transport code.

**Important notes:** Keep this aligned with the Node.js 24 development baseline. It is a development-only dependency and is excluded from the package tarball.
