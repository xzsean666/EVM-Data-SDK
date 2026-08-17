# External Integrations

Version: 0.4.0

Status: v0.1/v0.2/v0.3 accepted; v0.4 Chainlink Archive RPC integrations verified

Last verified against official sources: 2026-08-07

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
- Current ERC-20 holdings: https://docs.etherscan.io/api-reference/endpoint/addresstokenbalance
- Historical ERC-20 balance: https://docs.etherscan.io/api-reference/endpoint/tokenbalancehistory

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
- The V2 endpoint describes `offset` as records per page. SDK capability tests and the owner-requested live verification use the conservative 1–10,000 range; requests above 10,000 are rejected before network work. A 10,000-record page is still a page, not an all-history response.
- The SDK adapter sends `page`, `offset`, `sort`, and optional `startblock`/`endblock` on every list attempt; continuation state contains only the next page number.
- ERC-20 direction filtering is applied after the provider page is mapped. Provider page fullness, rather than filtered item count, determines whether another page is requested.
- `addresstokenbalance` is current-holding discovery only; it is not treated as a historic state assertion. `tokenbalancehistory` reads one explicit contract at one exact block. Both are Standard-plan-and-above PRO endpoints and Etherscan documents a fixed two-requests-per-second cap, which the adapter serializes.
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

**Purpose in the SDK:** latest native balance and ERC-20 transfer queries in every public direction.

**Base endpoint:** network-specific, for example `https://eth-mainnet.g.alchemy.com/v2`.

**Authentication:** `Authorization: Bearer <api-key>` header. Header authentication is selected to keep keys out of request URLs.

**Important notes:**

- Network hosts differ by chain. The chain registry owns the mapping, for example `eth-mainnet`, `bnb-mainnet`, `polygon-mainnet`, `arb-mainnet`, `base-mainnet`, and `opt-mainnet` where supported.
- `eth_getBalance` returns a hexadecimal wei quantity and costs compute units.
- `alchemy_getAssetTransfers` returns asset transfers and an optional `pageKey`; it is not a complete normal transaction history.
- A wallet-wide both-directions transfer query requires two independent streams (`fromAddress` and `toAddress`). The SDK requests both with the same fixed filters, combines the complete returned pages by block number and Alchemy `uniqueId`, and assigns self-transfers to the outgoing stream only so they cannot repeat across separately paged streams. `maxCount` applies independently to each stream, so one public response can contain up to twice the requested size. Its cursor contains the two Alchemy page keys and terminal flags only; it never contains transfers, API keys, or another provider's cursor. Alchemy documents an absent or blank `pageKey` as terminal; the adapter treats both forms as no continuation.
- `maxCount` defaults to `0x3e8` (1,000). The SDK therefore makes Alchemy ineligible for ERC-20 transfer requests above 1,000 rather than sending an upstream-over-limit request.
- Internal transfer data and metadata support vary by chain. v0.1 uses only the ERC-20 category needed by its contract.
- At verification time, throughput was account-level CU/s over a 10-second rolling token-bucket window. Different methods have different CU weights; `alchemy_getAssetTransfers` documented 120 CUs and `eth_getBalance` documented 20 CUs.
- HTTP 429 and JSON-RPC error envelopes must both be classified. Honor `Retry-After` when present and use bounded exponential backoff with jitter.
- Alchemy recommends HTTPS for request/response methods and batches below 50. v0.1 does not batch provider calls.
- Authorization headers and any legacy URL key form must be redacted.
- The adapter sends JSON-RPC requests to the registry's network-specific `/v2` endpoint with `Authorization: Bearer`; API keys never enter endpoint URLs. It maps `eth_getBalance` hexadecimal wei values and `alchemy_getAssetTransfers` ERC-20 pages with one single-stream or two both-direction `pageKey` continuations.
- Alchemy's currently integrated balance and transfer methods are JSON-RPC. They are deliberately excluded from API-only backend current-holdings and historical ERC-20 snapshot fallback; adding a REST semantic equivalent would require a separate documented contract and approval.

## 3. Moralis

**External project:** Moralis Data API

**Selected version:** EVM Data API v2.2

**Official documentation:**

- Data API overview: https://docs.moralis.com/data-api/overview
- EVM supported chains: https://docs.moralis.com/data-api/supported-chains
- Raw wallet transactions: https://docs.moralis.com/data-api/evm/wallet/wallet-transactions
- Native balance: https://docs.moralis.com/data-api/evm/wallet/native-balance
- ERC-20 transfers: https://docs.moralis.com/data-api/evm/wallet/token-transfers
- Transaction details: https://docs.moralis.com/data-api/evm/transaction/transaction-details
- Verbose transaction details: https://docs.moralis.com/data-api/evm/transaction/transaction-verbose
- Pagination: https://docs.moralis.com/data-api/resources/pagination
- Rate limits: https://docs.moralis.com/data-api/resources/rate-limits
- Response codes: https://docs.moralis.com/data-api/resources/response-codes

**Purpose in the SDK:** normal address transactions, latest native balance, ERC-20 transfers, wallet balance snapshots, and transaction context for action parsing.

**Base endpoint:** `https://deep-index.moralis.io/api/v2.2`

**Authentication:** `X-API-Key` header.

**Important notes:**

- Chain routing uses Moralis chain values supplied by the SDK chain registry. Feature support varies by chain even when the chain appears in a general support list.
- The raw wallet transactions endpoint `GET /{address}` aligns with v0.1 transaction semantics better than the enriched `GET /wallets/{address}/history` activity feed.
- Native balance is `GET /{address}/balance`; ERC-20 wallet transfers are `GET /{address}/erc20/transfers`.
- Moralis list endpoints use cursor pagination. Documentation states that limit is set on the initial request and cannot change mid-pagination, and that cursors represent a stable snapshot where supported.
- Wallet transaction and ERC-20 transfer `limit` values are limited by the SDK to 1–100. Larger public list pages are made ineligible before a Moralis request is attempted.
- Transaction context uses `GET /transaction/{transaction_hash}` with `chain`. The verified response is one object containing transaction/receipt fields and a nested `logs` array; each log includes its contract address, block/transaction/log indexes, topics, and data. The SDK fetches one hash per bounded batch, validates every log, and never substitutes the `/logs` subpath (which returned HTTP 404 in the live check).
- Wallet ERC-20 balances use `GET /{address}/erc20` with `chain` and required `to_block`. This is a REST Data API endpoint, not a JSON-RPC call. A proxy-only live check on 2026-08-06 returned an unpaged JSON array containing `token_address`, `balance`, and `decimals`; a request without `to_block` and a malformed `to_block` each returned HTTP 400. For current-holdings discovery, the SDK first resolves an indexed Etherscan head and passes it as `to_block`. The SDK does not send spam or verification exclusion filters, because doing so would make a requested contract set incomplete.
- The observed wallet-balance response has no cursor and does not honor the normal list `limit`. The adapter validates the complete array, rejects duplicate contract entries, and projects it only onto the caller-supplied contract set. An omitted requested contract is zero only after that full successful response; an error or malformed response never fabricates zeroes.
- At verification time, rate limits used a rolling four-second window. Published request throughput was 40 requests/s for Free and Starter, 80 for Pro, 200 for Business, and custom for Enterprise. Plans and endpoint compute costs may change and are not hardcoded defaults.
- HTTP 400, 401, 404, 425, 429, and 500 have conventional meanings, but 404 must be interpreted per endpoint rather than globally converted to an empty result. Moralis 425 responses are treated as transient provider unavailability and remain retryable.
- Prefer raw integer fields over formatted decimal fields when mapping public amounts.
- Redact `X-API-Key` and provider cursor values from observations.
- The adapter uses the raw transaction endpoint, native balance endpoint, ERC-20 transfer endpoint, and wallet ERC-20 balance endpoint with provider-local schemas. Its cursor is wrapped in the SDK cursor and is never exposed directly.
- For the proposed v0.3 block-range operation, Moralis is a planned peer candidate with Etherscan and Alchemy. Before source enablement, fixture tests must establish the exact `from_block`/`to_block` inclusive-boundary and terminal-response semantics; the scanner will use fresh range windows rather than carrying a Moralis cursor between windows.

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

## 5. sing-box (v0.3 proposal)

**External project:** sing-box by SagerNet

**Selected version:** `1.13.16` observed from the official latest release on 2026-08-06; the implementation must pin an explicit version and must not follow `latest` at runtime.

**Official documentation:**

- Configuration: https://sing-box.sagernet.org/configuration/
- Mixed inbound: https://sing-box.sagernet.org/configuration/inbound/mixed/
- VLESS outbound: https://sing-box.sagernet.org/configuration/outbound/vless/
- Shadowsocks outbound: https://sing-box.sagernet.org/configuration/outbound/shadowsocks/
- Official releases: https://github.com/SagerNet/sing-box/releases
- Releases API: https://api.github.com/repos/SagerNet/sing-box/releases

**Purpose in the SDK:** Optional v0.3 advanced proxy runtime. The SDK accepts `vless://` and `ss://` URLs, renders a restricted sing-box configuration with a loopback `mixed` inbound, and supplies the resulting local HTTP endpoint to the existing transport/execution layer. This feature is not part of the accepted v0.2 contract yet.

**Runtime/download policy:** Do not add the binary to the npm tarball and do not use an unconditional npm `postinstall` download. The proposal uses a fixed release version and lazy first-use download, with an explicit `binaryPath`/cache override for air-gapped deployments. The default official release assets currently use `amd64` and `arm64` names: Linux and macOS are `.tar.gz`, Windows is `.zip`; the required mappings are `linux|darwin|win32 × x64|arm64`.

**Pinned release manifest (verified from the immutable GitHub `v1.13.16` release API on 2026-08-06):** Tests use this manifest as fixture data; runtime code must verify the downloaded asset's SHA-256 before extraction and must not query GitHub `latest`.

| Runtime | Release asset | SHA-256 |
| --- | --- | --- |
| `darwin/x64` | `sing-box-1.13.16-darwin-amd64.tar.gz` | `2bfad58d034e280c773e194be03649555e5a7040c48b559dd0898ad293fe793d` |
| `darwin/arm64` | `sing-box-1.13.16-darwin-arm64.tar.gz` | `32fa21fd75ad62d86a2dcb7e0be77359c35e12798cdbb6a0e30654ef487d90d6` |
| `linux/x64` | `sing-box-1.13.16-linux-amd64.tar.gz` | `e37c312859dfa84cba148f41072ff6369f08361ae91d622dc1fd3aab49611a8d` |
| `linux/arm64` | `sing-box-1.13.16-linux-arm64.tar.gz` | `d587fb00bdc3c044227f35d15d154f271bc75108475091eda2542e4b82bb2949` |
| `win32/x64` | `sing-box-1.13.16-windows-amd64.zip` | `6cbf90ec4ee87122ffce09b73928fb31e763bc1c75a119f79c61d24734c78807` |
| `win32/arm64` | `sing-box-1.13.16-windows-arm64.zip` | `8412e9751a776a1cd5138fde8a6b60784af91b0fe596cba1b6efcd05144ef511` |

**Integrity and process boundary:** Downloaded archives must be verified against the release asset SHA-256 digest (or an explicitly configured trusted manifest) before atomic installation. Archive extraction must reject path traversal and the installed Unix binary must be user-executable only. Runtime configuration files contain proxy secrets and must be `0600`/current-user-only, never logged, and removed on close. The inbound must bind to loopback only; the SDK does not expose TUN, system routing, UDP, LAN listening, arbitrary sing-box JSON, or browser support.

**URL semantics:** VLESS URLs require a valid UUID, host, and port; the first implementation explicitly supports only the documented TLS/Reality and transport combinations. Shadowsocks URLs must decode a valid method/password/host/port form; SIP002 plugins are rejected until separately specified. Raw URLs, UUIDs, passwords, Reality keys, and full configs are secrets and must be redacted from errors, telemetry, cursors, fixtures, and package output.

**Open caveat:** sing-box may select among configured outbounds internally (for example through a URL-test group), while the SDK sees one loopback HTTP route. That is different from the SDK's existing per-proxy cooldown model and must be covered by an explicit architecture decision before implementation. The SDK must not describe this transport as a quota or provider-plan bypass.

## 6. Zod

**External project:** Zod

**Selected version:** 4.4.3

**Official documentation:** https://zod.dev/

**Purpose in the SDK:** runtime validation for client configuration, public requests, cursors, and untrusted provider response envelopes.

**Important notes:** Provider schemas are private. Public TypeScript types should have one clear ownership source; do not create drift between hand-written interfaces and inferred schemas.

## 7. TypeScript

**External project:** TypeScript

**Selected version:** 7.0.2, subject to toolchain compatibility verification before bootstrap

**Official documentation:** https://www.typescriptlang.org/docs/

**Purpose in the SDK:** implementation language and declaration generation.

**Important notes:** Strict flags in `BUILD.md` are required. Do not weaken compiler settings to accommodate provider payloads; validate unknown data at boundaries.

## 8. tsup

**External project:** tsup

**Selected version:** 8.5.1

**Official documentation:** https://tsup.egoist.dev/

**Purpose in the SDK:** ESM, CommonJS, declaration, and source map builds.

**Important notes:** The ESM/CJS bundling path in `tsup@8.5.1` works with TypeScript 7. Its declaration path is not compatible: the bundled `rollup-plugin-dts@6.1.1` crashes against TypeScript 7's compiler API. Work Package 1 disables tsup declaration bundling and invokes TypeScript 7 with `emitDeclarationOnly` after the JavaScript build. Recheck this workaround before upgrading either tool.

## 9. Vitest

**External project:** Vitest

**Selected version:** 4.1.10

**Official documentation:** https://vitest.dev/guide/

**Purpose in the SDK:** deterministic unit, adapter contract, execution integration, and live test orchestration.

**Important notes:** Default tests must not use the network or real time. Live tests are separately selected and credential-gated.

## 10. ESLint

**External project:** ESLint

**Selected version:** 10.8.0

**Official documentation:** https://eslint.org/docs/latest/

**Purpose in the SDK:** static analysis with flat configuration.

**Important notes:** The checked `@typescript-eslint/parser` and `@typescript-eslint/eslint-plugin` 8.66.0 peer ranges are `typescript >=4.8.4 <6.1.0`; with TypeScript 7.0.2 they fail at startup with `typescript-eslint does not support TS 7.0`. Work Package 1 therefore uses ESLint 10 flat config for JavaScript package tooling and smoke tests, while strict `tsc` validates TypeScript source. Do not add a TypeScript ESLint parser until it supports the selected TypeScript major.

## 11. Changesets

**External project:** Changesets

**Selected version:** 2.31.1

**Official documentation:** https://github.com/changesets/changesets/tree/main/docs

**Purpose in the SDK:** npm package versioning and changelog entries.

**Important notes:** Publishing remains blocked until package ownership, package name, access level, license, and CI provenance are approved.

## 12. pnpm

**External project:** pnpm

**Selected version:** 11.20.0

**Official documentation:** https://pnpm.io/

**Purpose in the SDK:** deterministic dependency management and scripts.

**Important notes:** Record the version in `packageManager` and commit `pnpm-lock.yaml`. CI uses `--frozen-lockfile`. pnpm 11.20.0 moved lifecycle approval to `pnpm-workspace.yaml`; this repository allows only `esbuild`, which tsup requires.

## 13. Node.js

**External project:** Node.js

**Selected version:** 24 LTS development baseline

**Official documentation:** https://nodejs.org/docs/latest-v24.x/api/

**Purpose in the SDK:** runtime, test runtime, and package build environment.

**Important notes:** HTTP(S) proxies are a Node-only SDK feature. Do not claim browser support in v0.1. Test any additional active LTS line before listing it in `engines`.

## 14. Node Type Definitions

**External project:** DefinitelyTyped Node.js declarations

**Selected version:** `@types/node` 24.0.0

**Official documentation:** https://github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node

**Purpose in the SDK:** Type declarations for Node.js APIs used by build configuration, package smoke tests, and later transport code.

**Important notes:** Keep this aligned with the Node.js 24 development baseline. It is a development-only dependency and is excluded from the package tarball.

## 15. Multicall3 (v0.4)

**External project:** Multicall3 (mds1/multicall3)

**Selected version:** the canonical deployed bytecode at
`0xcA11bde05977b3631167028862bE2a173976CA11` on Ethereum Mainnet; no source
dependency is added, only the ABI selectors used by hand-encoded calldata.

**Official documentation:**

- Repository and ABI: https://github.com/mds1/multicall3
- Deployment address: https://multicall3.com

**Purpose in the SDK:** batch `latestRoundData()`/`decimals()` reads for many
Chainlink feeds in a bounded number of `eth_call` requests, and the
public, Chainlink-agnostic `client.rpc.multicallAtBlock()` primitive.

**Verified Ethereum Mainnet deployment block:** `14,353,601`.

**Verification method (2026-08-07):** Resolved the contract's creation
transaction hash
(`0x00d9fcb7848f6f6b0aae4fb709c133d69262b902156c85a473ef23faa60760bd`) through
a public block-explorer API (Blockscout `addresses/{address}` endpoint,
`creation_transaction_hash`), then read that transaction's `block_number`
(`14353601`) directly. The Etherscan legacy V1 endpoint used in the same
check returned a deprecation notice (`"switch to Etherscan API V2"`), which is
independent corroboration that V1 hosts must not be used elsewhere in this
SDK either, consistent with ADR-004.

**Important notes:**

- `aggregate3((address target, bool allowFailure, bytes callData)[])` has
  selector `0x82ad56cb` and returns `(bool success, bytes returnData)[]` in
  input order.
- A request for a block below `14,353,601` must fail as
  `MULTICALL_NOT_DEPLOYED_AT_BLOCK` before any `eth_call`; the contract does
  not exist at an earlier state and calling it would return misleading empty
  returndata rather than a clear error.
- A live `aggregate3` call at block `18,000,000` batching
  `latestRoundData()` + `decimals()` for the ETH/USD proxy
  (`0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`) decoded identically to a
  direct `latestRoundData()` call at the same block, confirming selector and
  tuple-offset encoding end-to-end against a live public endpoint.
- The existing private encoder/decoder in `src/providers/alchemy/AlchemyAdapter.ts`
  hardcodes `allowFailure: true` and only understands `balanceOf`-shaped
  calls; v0.4 extracts the generic `aggregate3` ABI logic into
  `EthereumMulticall3Codec` and both call sites (Alchemy balances, the new
  `RpcService`) reuse it. Provider-specific error mapping and network access
  remain outside the codec.

## 16. Chainlink Data Feeds (v0.4)

**External project:** Chainlink Data Feeds

**Selected version:** `AggregatorV3Interface` (stable interface; no version
number is published for the interface itself), plus the feed metadata JSON
referenced by Chainlink's own documentation repository.

**Official documentation:**

- Price feed addresses: https://docs.chain.link/data-feeds/price-feeds/addresses
- API reference (`AggregatorV3Interface`): https://docs.chain.link/data-feeds/api-reference
- Documentation network metadata source: https://github.com/smartcontractkit/documentation/blob/main/src/features/data/chains.ts

**Feed metadata endpoint used by the manifest generator:**
`https://reference-data-directory.vercel.app/feeds-mainnet.json`

**Purpose in the SDK:** source data for the committed, generated Ethereum
Mainnet Crypto/USD feed manifest, and the ABI contract the SDK decodes
against every configured feed proxy.

**Verified interface (2026-08-07, from the official API reference):**

- `decimals() external view returns (uint8)`
- `latestRoundData() external view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)`
- The documentation explicitly marks `answeredInRound` as deprecated but does
  not itself assert monotonicity or the `startedAt <= updatedAt` invariant;
  those are SDK-side validation rules the v0.4 upgrade adds defensively, not
  a documented Chainlink guarantee. The SDK treats a violation as a per-feed
  `FEED_ANSWER_INVALID` failure rather than a fabricated price.
- Chainlink's own best practice is to call the proxy address through
  `AggregatorV3Interface` rather than the underlying aggregator directly,
  which the SDK follows: the generated manifest stores only `proxyAddress`.

**Feed metadata verification (2026-08-07):**

- Fetched `feeds-mainnet.json`: 290 entries, recorded SHA-256
  `bf7d6f90360ab0e8eec597668506119f273cc02551298ab01acb771c42c6e6ae`.
- Confirmed top-level and `docs.*` fields actually present in the payload:
  `productType`, `productTypeCode`, `productSubType`, `docs.assetClass`,
  `docs.quoteAsset`, `docs.hidden`, `docs.shutdownDate`,
  `secondaryProxyAddress` (present only on SVR/shared-SVR feeds).
- Applying the exact v0.4 selection rule (`productTypeCode == "RefPrice"`,
  `docs.quoteAsset == "USD"`, `docs.assetClass == "Crypto"`, no
  `secondaryProxyAddress`, `docs.hidden` not true, no `docs.shutdownDate`)
  yields **71** standard feeds with zero duplicate `proxyAddress` or `name`
  values. The six core mappings in the upgrade proposal (ETH/USD, BTC/USD,
  LINK/USD, USDC/USD, USDT/USD, DAI/USD) match this filtered set exactly.
  (Correction: an earlier pass through this same rule miscounted 72 by
  stopping after the `docs.hidden` exclusion and not separately applying the
  `docs.shutdownDate` exclusion. One entry, DOLO/USD, has no `docs.hidden`
  flag but does carry `docs.shutdownDate: "April 29th, 2026"`, so it must
  still be excluded. Re-deriving the filter against a byte-identical copy of
  the same source file, verified by matching SHA-256, confirms 71 is correct.)
- SVR/shared-SVR feeds (for example a EUR/USD entry carrying
  `secondaryProxyAddress`) and hidden/deprecating feeds (for example a
  BAT/USD entry with `docs.hidden: true` and a `docs.shutdownDate`, and a
  DOLO/USD entry with only `docs.shutdownDate` set) are confirmed present in
  the source data, so the exclusion rules are exercised against real
  records, not only a hypothetical schema.
- One filtered entry, "U / USD" (`proxyAddress`
  `0xF6351B2dCF0110E76c71C1d319Af2f410454B6f3`, `decimals: 18`), has no
  `docs.baseAsset` key (only `baseAssetClic`/`baseAssetEntityId`). The
  generator falls back to deriving `baseAsset` from splitting `name` on
  `" / "` for entries missing this field.

**Important notes:**

- The generator (`scripts/update-chainlink-ethereum-feeds.mjs`) is the only
  supported way to refresh the manifest. Runtime code never fetches this URL.
- `decimals()` is read live at call time and compared against the manifest's
  `expectedDecimals`; a mismatch is a feed-level failure and a maintenance
  signal, never a silently reformatted price.

## 17. Ethereum JSON-RPC and Archive RPC endpoints (v0.4)

**External project:** Ethereum JSON-RPC (execution API) plus five
independently operated unauthenticated public endpoints.

**Official documentation:**

- `eth_call`: https://ethereum.org/developers/apis/json-rpc/#eth_call
- `eth_chainId`, `eth_getBlockByNumber`: same JSON-RPC reference

**Selected built-in candidates and 2026-08-07 verification:**

| Stable ID | Endpoint | `eth_chainId` | Historical Multicall3 `getBlockNumber()` at block 18,000,000 |
| --- | --- | --- | --- |
| `drpc-public` | `https://eth.drpc.org` | `0x1` | passed on 2 of 3 attempts; rate-limited (`code 15`) on the first attempt only |
| `blastapi-public` | `https://eth-mainnet.public.blastapi.io` | `0x1` | passed |
| `mevblocker-public` | `https://rpc.mevblocker.io` | `0x1` | passed |
| `nodies-public` | `https://eth-pokt.nodies.app` | `0x1` | passed |
| `tenderly-public` | `https://mainnet.gateway.tenderly.co` | `0x1` | passed |

**Purpose in the SDK:** built-in candidate pool for `EthereumArchiveRpcPool`,
probed only when a caller enables `chainlink.enabled` and calls
`client.initialize()`.

**Important notes:**

- `drpc-public`'s single rate-limited attempt is recorded here as an
  observed instability, not a disqualification, consistent with the repeated
  three-probe rule in `CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md`. The
  passive health model already treats a transient endpoint failure as a
  retryable condition that triggers restart-on-another-endpoint rather than
  operation failure, so an occasionally rate-limited public endpoint remains
  a reasonable built-in as long as at least one other healthy endpoint
  exists per operation.
- All requests to these endpoints are direct-only: no proxy, no environment
  proxy variable is read, and the transport passes `proxy: null`
  unconditionally. This is independent of `requestPolicy.allowDirect`,
  `proxies`, and `advancedProxy`, which remain scoped to the existing
  credential-based execution and price paths.
- These are unauthenticated public services. Passing a point-in-time check
  is not a rate-limit, retention, or terms guarantee; see
  `CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md` for the update procedure
  and rejected-candidate history.

## 18. DeFi Exchange Rate Snapshot integrations (v0.5)

The module uses no new runtime dependency. It reuses Multicall3
`aggregate3((address,bool,bytes)[])` and the direct-only Archive RPC transport.
Protocol ABI selectors and mapping rules are recorded in
`docs/DEFI_EXCHANGE_RATE_SNAPSHOT/UPGRADE.md` and covered by fixture tests.

The Ethereum built-in Archive RPC registry retains the five verified
endpoints and adds additional public candidates where the maintenance check
confirms exact historical `eth_call` support. Base has a separate registry
(`src/rpc/builtinBaseArchiveRpcs.ts`) with chain ID `0x2105`; Base endpoints are
never probed as Ethereum endpoints. Public endpoints are best-effort,
unauthenticated services and may change archive retention or rate limits.

Initial manifest sources are official Lido, Rocket Pool, Aave, Compound,
Maker/Sky ERC-4626, Frax, Coinbase, and Uniswap contract/address
documentation. The registry is committed and versioned; runtime never calls
token-list or protocol metadata APIs. Address/ABI changes require rechecking
official sources and updating fixtures before changing the manifest.

**Chainlink-underlying selection rule (2026-08-08):** The default DeFi
registry is a reviewed allowlist, not a token-list crawl. Each underlying leg
records a `chainlinkAssetSymbol`, and a deterministic test requires that
identity to appear in the committed Chainlink Ethereum feed manifest. Aave
V2/V3 token and underlying addresses are sourced from the official
`bgd-labs/aave-address-book`. Aave aToken rates use Pool
`getReserveNormalizedIncome(address)` (`0xd15e0053`) and exact ray arithmetic,
rather than a fixed 1:1 assumption. Base entries use Base-specific official
addresses with the same committed asset identity allowlist.

**Aave address/runtime verification (2026-08-08):** An opt-in direct RPC
check at one exact current block confirmed deployed bytecode and a positive
`getReserveNormalizedIncome` result for all 26 added Ethereum Aave entries on
endpoint ID `drpc-public`, and all 7 added Base entries on endpoint ID
`base-drpc`. The check logged only chain ID, endpoint ID, fixed block number,
and pass counts; it did not log URLs, calldata, returndata, or rates.

**Base Multicall3 deployment and candidate pool verification (2026-08-07):**
a direct, unauthenticated `eth_getCode` check against
`0xcA11bde05977b3631167028862bE2a173976CA11` on three independent Base public
endpoints (`base.drpc.org`, `base-mainnet.public.blastapi.io`,
`base.meowrpc.com`) returned empty bytecode at block `5021` and the canonical
Multicall3 runtime bytecode at block `5022`, confirming
`MULTICALL3_BASE_MAINNET_DEPLOYMENT_BLOCK = 5022n` in
`src/rpc/EthereumMulticall3Codec.ts`. All three endpoints also answered
`eth_chainId` with `0x2105`. `base.publicnode.com` answered `eth_chainId`
correctly but rejected `eth_getCode`/`eth_call` at that historical block with
`"Archive requests require a personal token"` — the same failure mode already
recorded for Ethereum's PublicNode candidate — so it was removed from
`BUILTIN_BASE_ARCHIVE_RPCS` rather than kept as a false-positive built-in.
This is only an endpoint/deployment-block verification snapshot.

**DeFi token registry address correction (2026-08-07):** a follow-up
`eth_getCode` sweep of every address in `src/defi/defiTokenRegistry.ts` found
that all 14 Ethereum entries have deployed bytecode, but three Base
`underlyings` addresses were incorrect (`USDbC`, `cbETH`, and `wstETH` legs on
the `base:aave-v3:ausdbc`/`acbeth`/`awsteth` entries) — `eth_getCode` returned
empty at those addresses. The five Aave V3 Base `aToken` addresses themselves
were correct. Corrected values were sourced from the official
`bgd-labs/aave-address-book` `AaveV3BaseAssets` Solidity constants
(`USDbC_UNDERLYING = 0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA`,
`cbETH_UNDERLYING = 0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22`,
`wstETH_UNDERLYING = 0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452`) and
re-confirmed with `eth_getCode` on `base.drpc.org`. The Base native `USDC`
underlying address was also re-checksummed to
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` during this pass; its value was
already correct, only casing changed.

**End-to-end live verification (2026-08-07):** after the address and endpoint
corrections above, `client.defi.getExchangeRatesAtBlock()` was run opt-in
against the public built-in Archive RPC pools (no proxy, no application
credentials). All 10 configured Ethereum tokens resolved with zero failures
at block `21,000,000`; all 5 configured Base tokens resolved with zero
failures at block `25,000,000`. `multicallBatches` was 1 for each chain. No
endpoint URL, calldata, return data, or resolved rate value was printed —
only the aggregate summary (`configuredTokens`/`succeededTokens`/`failedTokens`
/`multicallBatches`) and failure `tokenId`/`code` pairs, which were empty.

## 19. Blockscout Etherscan-compatible API

**External project:** Blockscout

**Selected interface:** Etherscan-compatible JSON API (`/api`), not the
Blockscout v2 REST resource API (`/api/v2`).

**Documentation:**

- API overview: https://docs.blockscout.com/devs/apis
- Etherscan-compatible RPC API: https://docs.blockscout.com/devs/apis/rpc/eth-rpc
- Hosted Ethereum instance API: https://eth.blockscout.com/api

**SDK purpose:** normal address transactions (`account/txlist`), latest native
balance (`account/balance`), ERC-20 transfers (`account/tokentx`), and the
existing SDK block-range scanner over `tokentx`. Explorer instances that expose
compatible `tokenbalancehistory`, `addresstokenbalance`, or
`block/getblocknobytime` may also serve the matching API-only SDK operations.

**Authentication:** caller-supplied API key in the `apikey` query parameter.
Each configured Blockscout provider has an independent `CredentialPool`.

**Routing:** Blockscout endpoints are deployment/network specific. The built-in
Ethereum route is `https://eth.blockscout.com/api`; other chains require a
verified `routes.blockscout.apiUrl`. An explicit provider `baseUrl` only
overrides an already eligible chain route and never broadens capability. The adapter
does not send Etherscan V2's `chainid` parameter and does not discover URLs at
runtime.

**Compatibility limits:** API-compatible instances can vary by Blockscout
version and operator configuration. HTTP success can still contain a logical
`status: "0"` error or empty result. The SDK validates the Etherscan-shaped
envelope and maps safe error codes; it does not enable Blockscout v2 REST-only
fields or assume unverified endpoints are semantically equivalent. The current
implementation is covered by deterministic fixtures. No authenticated live
smoke was run in this work package, so each production instance should be
checked with the bounded procedure in `docs/BLOCKSCOUT_PROVIDER/UPGRADE.md`.

## Persistent sync storage

The replay upgrade uses Node 24's built-in `node:sqlite` driver for the default
`sqlite:./data/evm-data-sdk.db` URL. `initialize()` creates the parent directory
and applies versioned migrations; `close()` releases the handle. PostgreSQL uses
the `pg` pool through the same `StorageAdapter` contract and migration versions;
the PostgreSQL live contract requires an explicitly supplied test database.
Storage URLs and SQL are never logged.

## 20. Generic exact-block contract Multicall

`client.token.getMulticallAtBlock()` and its `multicallAtBlock()` alias expose
the provider-neutral Multicall3 primitive for application-specific read-only
contract calls. Callers provide validated target addresses and ABI calldata;
the SDK owns exact-block pinning, deterministic batch splitting, endpoint
failover, block consistency, and per-call success/return-data mapping. This
does not add ABI-specific protocol knowledge or token discovery. It requires
the opt-in chain-scoped Archive RPC capability and returns the existing typed
unsupported-operation error when that capability is disabled.
