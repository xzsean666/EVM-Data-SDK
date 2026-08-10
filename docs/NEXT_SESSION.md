# Current Progress

## 2026-08-10 Uniswap V3 Historical Price

Implementation is present for the Ethereum-only opt-in module. Added strict
`uniswapV3` configuration, public request/result/failure models, static
versioned WETH/USDC manifest, slot0 ABI validation, pure BigInt spot and
TickMath calculations, shared-pool Multicall3 service, client composition and
Archive pool initialization, public exports, and the maintainer-only
`pnpm uniswap:v3:update` command.

The constructor performs no RPC work; requests use the existing exact-block
Archive executor and expose stable endpoint IDs only. Deterministic repository
checks pass: `pnpm typecheck`, `pnpm lint`, `pnpm test` (343 tests), `pnpm
build`, `pnpm test:package`, and `pnpm check`. Live pool/address verification
and a reviewed generated-manifest refresh remain separate maintainer work.

Last updated: 2026-08-08

Workflow state: Step 4/5 v0.5 DeFi Exchange Rate Snapshot implementation in progress after v0.4 Chainlink Archive RPC/Multicall3; release decisions and Git identity remain outside implementation scope.

## 2026-08-08 v0.5 DeFi Exchange Rate Snapshot

The owner requested an exact-block DeFi Token -> Underlying exchange-rate
module for Ethereum Mainnet and Base Mainnet. The design and handoff package
is under `docs/DEFI_EXCHANGE_RATE_SNAPSHOT/`. Source implementation is the
current work package; no live claim is made until bounded public RPC smoke
checks pass.

Planned bounded packages:

1. Parameterize Archive RPC pool/executor/RpcService for chain ID and
   per-chain Multicall3 deployment boundaries; add Base public endpoint pool.
2. Add DeFi domain contracts, committed Ethereum/Base token manifests, and
   pure protocol adapters (LST, fixed lending, ERC-4626, Compound V2, LP).
3. Compose `client.defi`, initialize all enabled chain pools, and export the
   public models/configuration.
4. Add fixture tests, endpoint fallback tests, package checks, and record live
   verification evidence.

Completed implementation record (2026-08-08):

- Added chain-scoped Archive RPC support to `RpcService`, including Base's
  Multicall3 deployment boundary and committed Base public candidate pool.
  Existing Ethereum/Chainlink behavior remains covered by the deterministic
  suite.
- Added `src/domain/defiExchangeRateModels.ts`, committed Ethereum/Base DeFi
  registry definitions, pure fixed-ratio/wstETH/rETH/ERC-4626/Compound V2/LP
  adapters, and `DeFiExchangeRateService`. `client.defi` is nullable unless
  `defi.enabled` is set; enabled pools are initialized alongside Chainlink.
- Added deterministic tests for all adapters, partial and all-failure service
  results, exact block normalization, LP legs, token subsets, deployment
  filtering, Base boundary selection, and Base client-pool initialization.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` pass (333 tests).

Chainlink-underlying expansion (2026-08-08): every default DeFi underlying
now maps to a committed Chainlink asset identity, enforced by
`tests/unit/defi-registry.test.ts`. Aave V2/V3 uses official address-book
addresses and dynamic normalized-income ray arithmetic; fixed 1:1 aToken
mapping was removed. Unsupported identities such as frxETH are not included
until a committed Chainlink mapping exists.
- Address/runtime follow-up: official Aave address-book entries were checked
  at one exact current block. All 26 expanded Ethereum entries and all 7
  expanded Base entries had deployed bytecode and positive Pool normalized
  income at endpoint IDs `drpc-public` and `base-drpc`, respectively. No URL,
  calldata, returndata, or rate was recorded.

Live verification follow-up (2026-08-07): a direct, unauthenticated
`eth_getCode` sweep of every registry address found three fabricated Base
`underlyings` addresses (`USDbC`, `cbETH`, `wstETH` legs on the Aave V3
entries); they were corrected against the official `bgd-labs/aave-address-book`
`AaveV3BaseAssets` source and re-confirmed on-chain. `base-publicnode` was
removed from `BUILTIN_BASE_ARCHIVE_RPCS` because it rejects historical
`eth_call`/`eth_getCode` with "Archive requests require a personal token",
the same failure already recorded for Ethereum PublicNode. Base's Multicall3
deployment block (`5022`) was confirmed live against three independent
endpoints. After these fixes, an opt-in live run of
`client.defi.getExchangeRatesAtBlock()` against the public built-in Archive
RPC pools succeeded with zero failures for all 10 Ethereum tokens (block
21,000,000) and all 5 Base tokens (block 25,000,000). See
`docs/INTEGRATIONS.md` section 18 for full evidence. No URL, calldata,
return data, or rate value was logged.

Non-negotiable invariants: direct-only Archive RPC; no background health timer;
random healthy endpoint permutation; one endpoint pinned per operation; full
restart after retryable endpoint failure; exact decimal-string arithmetic;
per-token partial failures; no runtime token-list discovery.

## 2026-08-07 v0.4 Proposal: Chainlink Historical Prices via Ethereum Archive RPC and Multicall3

**Status:** Approved by the owner on 2026-08-07. P0 through P5 are complete:
pure ABI codecs (Multicall3 `aggregate3`, Chainlink `AggregatorV3Interface`),
`ArchiveRpcTransport`/`EthereumArchiveRpcExecutor`/`EthereumArchiveRpcPool`
(direct-only, random-pinned, restart-on-retry per ADR-029), `RpcService`
(`multicallAtBlock`), `ChainlinkService`
(`getTokenPricesAtBlock`), `EvmDataClient` wiring (`client.rpc`/`client.chainlink`,
concurrent Archive RPC pool + managed proxy initialization), and full unit
test coverage (`tests/unit/chainlink-service.test.ts`,
`tests/unit/client.test.ts`, `tests/unit/archive-rpc-transport.test.ts`, and
related Multicall3/RPC-service suites). P6 (review, documentation, packaging,
verification) is in progress: this file, `README.md`, and
`scripts/probe-ethereum-archive-rpcs.mjs` (with its `pnpm
probe:ethereum-archive-rpcs` script entry) were added/updated as part of P6.
See `docs/DECISIONS.md` ADR-028/ADR-029 and `docs/INTEGRATIONS.md` sections
15-17 for recorded P0 evidence.

**Design source:**
`docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MULTICALL3_UPGRADE.md`

**Claude Sonnet 5 handoff:**
`docs/CLAUDE_SONNET_5_CHAINLINK_ETHEREUM_ARCHIVE_RPC_MULTICALL3_IMPLEMENTATION_PROMPT.md`

**RPC/feed maintenance:**
`docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md`

**Adding another chain (e.g. Base) to this feature:**
`docs/CHAINLINK_ARCHIVE_RPC_MULTICALL3_ADD_CHAIN_HANDOFF.md` is a
self-contained handoff for a future AI session: current Ethereum-only
architecture, every hardcoded `chainId: 1`/Ethereum assumption and its exact
file/line, and the required work packages to add a second chain without
breaking Ethereum. Give that document directly to the next AI along with
`Agent.md`.

The proposal adds an opt-in Ethereum Mainnet Chainlink namespace that accepts
one block number and reads every enabled standard Crypto/USD feed in a
versioned built-in manifest. It extracts the existing private Multicall3 codec
into a reusable public exact-block module, probes multiple Archive RPCs during
explicit asynchronous client initialization, randomly pins each operation to
one healthy endpoint, and restarts the complete operation on another endpoint
after a retryable RPC/archive failure.

All JSON-RPC traffic introduced by this proposal is direct-only: it must never
use `ProxyPool`, managed sing-box, configured HTTP proxies, or environment
proxy discovery. Existing indexed REST and market API proxy behavior is not
changed. A new accepted ADR is required because the current backend integration
is deliberately API-only; the proposed oracle snapshot must remain an explicit
optional SDK feature and must not replace that backend truth.

Five unauthenticated candidates answered an Ethereum historical Multicall3
`eth_call` at block `18,000,000` on 2026-08-07: dRPC, BlastAPI, MEV Blocker,
Nodies, and Tenderly. This is only a verification snapshot.

**P0 verification completed 2026-08-07:**

- Multicall3's Ethereum Mainnet deployment block is `14,353,601`, confirmed
  from the contract's creation transaction (`0x00d9fcb7848f6f6b0aae4fb709c133d69262b902156c85a473ef23faa60760bd`)
  via a public block explorer API. Recorded in `INTEGRATIONS.md` section 15.
- `AggregatorV3Interface.decimals()` and `.latestRoundData()` signatures and
  tuple ordering were confirmed against the official Chainlink API reference
  and match the proposal exactly.
- `feeds-mainnet.json` (290 entries, SHA-256 recorded in `INTEGRATIONS.md`
  section 17) was fetched and filtered by the exact v0.4 selection rule
  (`productTypeCode == "RefPrice"`, `docs.quoteAsset == "USD"`,
  `docs.assetClass == "Crypto"`, no `secondaryProxyAddress`, not
  `docs.hidden`, no `docs.shutdownDate`). This yields **71** standard
  Crypto/USD feeds with zero duplicate addresses or names; the six core
  mappings in the proposal's sample table (ETH/USD, BTC/USD, LINK/USD,
  USDC/USD, USDT/USD, DAI/USD) match exactly. (An earlier pass miscounted 72
  by not separately applying the `docs.shutdownDate` exclusion to DOLO/USD,
  which has no `docs.hidden` flag; see `INTEGRATIONS.md` section 16 for the
  correction.)
- A live `aggregate3` call encoding `latestRoundData()` + `decimals()` for the
  ETH/USD proxy at block 18,000,000 decoded identically to a direct
  `latestRoundData()` call, confirming selector `0x82ad56cb` and the tuple
  layout end-to-end.
- Endpoint re-probe: `blastapi-public`, `mevblocker-public`, `nodies-public`,
  and `tenderly-public` passed cleanly (chainId `0x1`, historical
  `getBlockNumber()` == 18,000,000). `drpc-public` was rate-limited on its
  first of three attempts and passed on the next two; this is recorded as an
  observed instability rather than a disqualification, per the maintenance
  doc's repeat-probe rule.
- A new ADR exception (ADR-028) was added because this feature is direct
  JSON-RPC, which the existing ADR-023 (API-only chain data) otherwise
  excludes; ADR-029 records the RPC pool/random-endpoint-selection design.

## 2026-08-06 API-only Backend Integration Update

The backend integration now consumes the following SDK API-only operations:

- `client.chain.getLatestBlockNumber()` and `getBlockNumberByTimestamp()` for a finalized, 30-day onboarding boundary;
- `client.token.getErc20TransfersByBlockRange()` for one address-scoped ERC-20 transfer scan;
- `client.token.getErc20TokenHoldings()` plus `getErc20BalancesAtBlock()` for exact opening ERC-20 balances; and
- `client.address.getTransactionsByBlockRange()`, `getInternalNativeTransfersByBlockRange()`, and `getBeaconWithdrawalsByBlockRange()` for normalized PostgreSQL ingestion.

The token-holdings endpoint is discovery only. The backend unions current
holdings with contracts observed in the 30-day transfer range, then requests
each contract's exact opening balance through an indexed API. Etherscan uses
`tokenbalancehistory` and is serialized at two requests per second; when its
Standard+ endpoints reject the configured credentials, Moralis REST obtains a
complete wallet snapshot at the requested historical block and projects it
onto the same candidate contracts. Neither path uses RPC.

Backend verification on 2026-08-06: API-only finalized-head succeeded with
direct traffic disabled and a managed local sing-box route. A real
`addresstokenbalance` smoke reached Etherscan through the same route and
returned `PLAN_RESTRICTED` after every configured Etherscan credential was
tried. The SDK now falls back to Moralis's REST wallet-balance endpoint: a
VLESS-only smoke completed both current-holdings discovery (using an indexed
Etherscan head as Moralis `to_block`) and an explicit historical snapshot.
The smoke logged no credential, proxy URI, continuation cursor, block value,
or raw provider response.

The SDK treats opaque non-retryable logical rejections from those two
documented Standard+ endpoints as `PLAN_RESTRICTED`, tries a later configured
Etherscan credential after authentication or plan rejection, and then tries
the compatible Moralis REST adapter. Alchemy's JSON-RPC endpoints remain
excluded from this backend path. `pnpm check` had previously passed with 17
test files / 156 tests; rerun it after this work package before release.

The next SDK P0 work remains receipt/full-log and exact effective-gas-price
contracts needed by the backend Action Parser. Do not replace those operations
with RPC fallbacks: this integration is explicitly API-only.

## v0.3 Proposal: Advanced Proxy and Block-Range ERC-20 Reads

**Status:** ADR-023/ADR-024 were explicitly approved by the owner on 2026-08-06; source implementation and deterministic verification are complete in the working tree.

**Design source:** `docs/PROXY_AND_BLOCK_RANGE_UPGRADE.md`
**Terra handoff:** `docs/GPT_TERRA_IMPLEMENTATION_PROMPT.md`

The proposal keeps existing HTTP(S) proxy and page/cursor APIs compatible. It
adds an opt-in `advancedProxy.kind: "sing-box"` runtime for fixed-version
VLESS/SS URL lists and a separate
`client.token.getErc20TransfersByBlockRange()` operation that hides page size,
scans an inclusive block interval through a ledger of disjoint adaptive windows,
restarts each smaller window as a new range request, de-duplicates stable
transfer identities, and can complete different windows through Etherscan,
Alchemy, or Moralis with explicit provenance.

### Approved work packages

1. **P0 — Recheck integrations and approve decisions**: verify sing-box release asset names/digests, VLESS/SS fields, mixed inbound behavior, and each provider's block-range parameters. Update `INTEGRATIONS.md` before adding dependencies or source.
2. **P1 — Public range and runtime contracts**: configuration schemas, request/result models, error codes, service method, `initialize()`/`close()` lifecycle contract, and capability names.
3. **P2 — VLESS/SS parser and sing-box config**: strict URL validation, secrets-safe internal representation, loopback-only mixed inbound, outbound generation and config fixtures.
4. **P3 — Binary manager/runtime**: fixed platform mapping, digest verification, safe archive extraction, cache, child-process seam, readiness, cancellation and cleanup. No npm postinstall and no binary in the tarball.
5. **P4 — Provider range adapters**: implement Etherscan, Alchemy dual-stream, and Moralis range adapters; lock every provider's boundary and terminal semantics with official-source-backed fixtures before enablement.
6. **P5 — BlockRangeScanner and composition**: adaptive coverage windows, fresh range re-queries, provider rotation at window boundaries, explicit provenance, dedup/order, incomplete/stalled errors, record safety bounds, public exports and proxy integration for data/price paths.
7. **P6 — Verification and docs**: deterministic fake transport/process/downloader tests, opt-in live smoke with `.env.key` held in memory, package tarball secret scan, README and all required handoff updates.

**P0 evidence recorded:** The official immutable GitHub release API confirms the six `sing-box` `v1.13.16` desktop/server assets and their SHA-256 digests. `INTEGRATIONS.md` now records the pinned fixture manifest. Alchemy's official Transfers reference confirms `fromBlock`, `toBlock`, `fromAddress`, `toAddress`, `maxCount`, and `pageKey`. The Moralis documentation endpoint returned HTTP 403 in this environment, so its exact range-boundary/terminal behavior still requires an official-source capture and fixtures before source enablement.

### Current risks and open decisions

- A sing-box `urltest` group appears as one local proxy to the SDK; per-node SDK cooldowns would require a different runtime/control API. The owner must accept this trade-off or choose one process per node.
- sing-box release assets and schema fields can change; a fixed version and digest must be recorded before implementation.
- Returning every range record as one array can exhaust memory. `maxRangeRecords` must fail explicitly; async iteration is a later extension.
- Provider-specific range filters may not have equivalent snapshot/finality semantics. Window-level mixing is intentional, so the completed-window ledger, item provenance, and aggregate provider/window counts must prove coverage and prevent silent source mixing.
- The implementation must preserve the coverage-ledger invariants while adding the authorized source files.

### v0.3 implementation completed (uncommitted)

- Added the public ERC-20 block-range request/result contracts, typed range and sing-box errors, `maxRangeRecords`/`maxRangeWindows`, and `client.token.getErc20TransfersByBlockRange()`. The scanner uses fresh, non-overlapping closed windows, BigInt splitting, explicit provenance, safe identity rules, full-coverage verification, and bounded `BLOCK_RANGE_STALLED`/`BLOCK_RANGE_INCOMPLETE` outcomes.
- Added range-window adapters for Etherscan (`page=1`, `offset=10000`, ascending), Alchemy (fresh incoming/outgoing streams with outgoing-only self transfers), and Moralis (fresh `from_block`/`to_block`, ascending). No provider cursor or page key is carried between windows.
- Added opt-in VLESS/Shadowsocks parsing, loopback-only sing-box config rendering, pinned `1.13.16` release/digest handling, temporary private runtime configuration, readiness probing, idempotent bounded shutdown, and `initialize()`/async `close()` on the client. Both data execution and price `proxy-only` requests consume only the managed loopback HTTP route.
- Deterministic tests cover scanner splitting, coverage/provenance, deduplication, dense-block stalling, range limits, all three provider range request shapes, VLESS/SS validation, loopback config, eager lifecycle behavior, and secret-safe failures. Default tests neither download nor launch sing-box.
- The complete verification set now passes: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm test:package`. No Git commit was made because repository author identity remains unset.

## Work Package 10: Page-size-aware routing and Etherscan full-data mode

**Status:** Completed. `pnpm check` passes with 133 deterministic tests and package smoke validation.

**Purpose:** Raise the public list-page ceiling to the verified Etherscan capacity while preventing requests from reaching providers whose own page limit is lower.

**Files:** `src/domain/operations.ts`, `src/execution/ProviderRouter.ts`, built-in list adapters, cursor tests, router/adapter/client tests, `scripts/live-smoke.mjs`, README, and the required architecture/integration/decision/build documents.

**Design:** `pageSize` accepts 1–10,000. Moralis is eligible through 100, Alchemy ERC-20 through 1,000 per stream, and Etherscan through 10,000. `fullData: true` forces Etherscan, defaults an omitted page size to 10,000, and remains cursor-paginated rather than performing unbounded aggregation.

**Acceptance:** Deterministic tests prove provider eligibility at 100, 1,000, 1,001, and 10,000; a cursor rejects a changed `fullData` setting; no over-limit provider request is sent; and opt-in live checks use `.env.key` without printing secret values, URLs, cursors, or returned records.

**Live verification (2026-08-06):** The public Vitalik address (`0xd8dA…96045`) was used with the application-owned `.env.key` values held only in memory. Alchemy successfully returned exactly 1,000 incoming ERC-20 transfers with a continuation cursor at `pageSize: 1000`. Alchemy balance and two small directional pages, plus Moralis balance and two small transaction pages, also succeeded. Etherscan balance, small list calls, and `fullData` (the 10,000-record Etherscan request) returned normalized `REQUEST_TIMEOUT` in this network environment, so no claim is made that the upstream completed that large response here. Moralis ERC-20 returned retryable `PROVIDER_UNAVAILABLE`. No key, authenticated URL, provider cursor, or record payload was logged.

## Work Package 11: Alchemy both-direction ERC-20 merge

**Status:** Completed. Fixture tests, two-page live verification, and the full package check pass with 138 deterministic tests.

**Purpose:** Make Alchemy support the same public ERC-20 direction options as Etherscan and Moralis without exposing or crossing provider cursors.

**Design:** A both-direction request makes one incoming and one outgoing Alchemy Transfers API call with the same filters, merges their complete pages by block number and `uniqueId`, and stores only dual Alchemy page keys plus terminal flags in its SDK cursor. `pageSize` applies per stream, so the public page may contain up to twice that number of records. Continuations remain pinned to Alchemy; the request executor never falls back to another provider after a cursor has been issued.

**Acceptance:** Fixture tests cover stream request construction, deterministic merge order, self-transfer partitioning across differently paced streams, two-stream continuation, blank terminal page keys, malformed dual state, max-size capability routing, and cursor pinning. A low-volume live request against the public test address succeeds through Alchemy. The user-supplied Etherscan proxy is separately recorded as `PROXY_ERROR` without exposing its URL or credentials.

**Live verification (2026-08-06):** Alchemy `direction: "both"`, `pageSize: 5`, on the public Vitalik address returned 10 merged records and a cursor on page one; its Alchemy-pinned continuation returned another 10 records and a next cursor on page two. The user-supplied Etherscan proxy returned `PROXY_ERROR` before any Etherscan data response. No secret, proxy URL, cursor, or record contents were printed.

## Completed

- Confirmed the repository was empty and had no existing implementation, dependencies, or commits.
- Converted the initial draft into a provider-capability-aware v0.1 specification.
- Defined public semantics for normal transactions, latest native balance, and ERC-20 transfers.
- Defined EIP-155 chain identity, six initial built-in chains, precision-safe public models, typed errors, and provider-pinned pagination.
- Defined bounded central execution, credential/proxy state, passive health, cancellation, redaction, and testing boundaries.
- Verified current official documentation for Etherscan V2, Alchemy, Moralis Data API v2.2, and the proposed toolchain.
- Confirmed that Etherscan V2 uses one unified API host plus `chainid`; legacy per-explorer V1 API hosts are deprecated.
- Recorded architecture decisions and external integration constraints.
- Prepared an ordered implementation plan sized for focused Terra coding sessions.
- Recorded the owner's architecture approval and changed the specification, architecture, and ADR statuses to `Accepted`.
- Bootstrapped the pnpm package, strict TypeScript 7 compiler configuration, tsup ESM/CJS build, flat ESLint configuration, Vitest, Changesets, and a minimal empty public entry point.
- Added package smoke tests that inspect tarball contents and consume the package through ESM, CommonJS, and TypeScript imports.
- Verified that TypeScript ESLint 8.66.0 rejects TypeScript 7, so JavaScript tooling is linted by ESLint 10 and TypeScript is checked by strict `tsc` until a TS 7 parser is released.
- Verified that tsup 8.5.1's declaration plugin fails against TypeScript 7; declarations are emitted by TypeScript 7 after tsup's JavaScript build.
- Implemented the public domain models, typed errors, request normalization, configuration validation, pagination contracts, six built-in chain definitions, and immutable `ChainRegistry`.
- Added fixture-free unit coverage for precision-safe quantities, null semantics, address/filter validation, configuration defaults, duplicate chain rejection, alias/ID resolution, custom routes, and frozen chain output.
- Kept internal registry and normalization implementations out of the package root exports while exposing the documented public contracts.
- Implemented the provider-neutral `HttpTransport` contract and Axios transport with bounded timeouts, abort propagation, non-2xx body preservation, explicit HTTP(S) proxy handling, direct-route `proxy: false`, and redirect suppression.
- Added transport error normalization for invalid requests, aborts, timeouts, network failures, and proxy-boundary failures without retry or provider decisions.
- Added secret-aware redaction for authenticated URLs, query keys, headers, proxy credentials, provider page keys, nested/cyclic values, and Axios error/config/response echoes.
- Defined the one-attempt `DataProviderAdapter` contract with capability checks, normalized operation requests, credential/proxy leases, timeout/signal context, and correlation IDs.
- Added transport and provider contract tests; `pnpm check` passes with 27 tests and package smoke coverage.
- Implemented the versioned base64url cursor codec with strict size/schema validation, safe provider page-state validation, immutable decoded state, and deterministic SHA-256 semantic-query fingerprints.
- Added cursor matching for operation, resolved chain, and all normalized semantic filters while excluding cursor, signal, credentials, timeout, and provider choice from the fingerprint.
- Added `providerConfigurationId` to cursor identity so continuation can reject removed or changed configured providers without falling back across providers.
- Implemented `ProviderRouter` with configured-priority ordering, exact capability plus method checks, typed unsupported-chain/operation errors, and provider-pinned continuation routing.
- Added cursor and router tests for round trips, corrupt/oversized/unknown cursors, secret/URL rejection, query mismatches, provider removal, capability predicates, priority order, and no-eligible-provider behavior; `pnpm check` passes with 36 tests.
- Implemented fair, instance-local `CredentialPool` leases with invalid-key disablement, bounded rate cooldowns, gradual success recovery, and stale-lease protection.
- Implemented `ProxyPool` with explicit HTTP(S) validation, fair leases, transport-only cooldowns, direct-route policy, and redaction-safe state snapshots.
- Implemented pure `RetryPolicy` decisions for credential rotation, proxy rotation, provider fallback, cancellation, Retry-After, bounded exponential jitter, and continuation restrictions.
- Implemented `RequestExecutor` with one total attempt counter, provider pacing, per-attempt timeout context, overall deadline, cancellation-aware waits, first-page fallback, continuation pinning, cursor conversion, and sanitized structured observations.
- Added deterministic execution tests for key rotation/cooldown, proxy failure rotation, proxy/direct round-robin routing, 429 handling, proxy policy, fallback order, continuation stop, deadline exhaustion, abort during sleep, pacing, stale leases, passive provider health cooldown, custom-adapter key/proxy/page-state redaction, and proxied HTTP 407 classification; the full suite now has 111 tests.
- Implemented the Etherscan V2 adapter for `account/txlist`, `account/balance`, and `account/tokentx` using the unified V2 endpoint and decimal `chainid` routing.
- Added provider-local Zod schemas, mappers, and error classifiers for logical HTTP 200 envelopes, empty pages, invalid keys, plan restrictions, unsupported chains, rate limits, busy/timeout responses, malformed payloads, and selected HTTP statuses.
- Added page/offset continuation state, fixed query filters, SDK-side ERC-20 direction filtering, canonical decimal quantities, ISO UTC timestamps, contract-creation handling, and null optional fields.
- Added fixture-backed Etherscan adapter tests covering success, empty results, pagination, balance metadata, direction filtering, reverted/unknown transactions, malformed responses, transport normalization, secret redaction, and provider error classes.
- Implemented the Moralis vertical slice for raw transactions, native balances, ERC-20 transfers, cursor continuation, raw quantity mapping, and provider-local error handling.
- Implemented the scoped Alchemy vertical slice for native balances and directional ERC-20 transfers with JSON-RPC/page-key handling; unsupported transaction and both-direction requests are filtered before network work.
- Composed `EvmDataClient`, address/token services, built-in adapters, pools, router, executor, public exports, README, package smoke consumers, and client-level fallback tests.
- Completed Step 5 review fixes for explicit insecure gateway opt-in, strict proxy URL validation, safe public error causes, mixed direct/proxy route rotation, proxied HTTP 407 and generic connection-failure classification, Moralis HTTP 425 classification, passive provider cooldowns, and final custom-adapter error-message redaction.
- Ran the owner-invoked live smoke/config scripts against `.env.key` in memory. Alchemy balance and directional ERC-20 pagination succeeded; Moralis balance and transaction pagination succeeded; proxy-only and mixed routes were exercised for every configured provider. Proxy-only availability can vary by run and is normalized as a retryable proxy route failure; mixed requests rotated to a succeeding direct route. Etherscan returned normalized timeouts and Moralis ERC-20 observed a retryable provider-unavailable response in this environment. No secrets or cursors were printed.

## Current State

- Complete-window streaming is implemented for ERC-20 and normal transaction
  block-range operations. `onWindow` is awaited only after a terminal closed
  window is validated; callback mode returns an empty aggregate `items` array
  to avoid retaining historical results. Normal transactions now split a dense
  full first page instead of carrying its continuation. Deterministic scanner
  and client tests pass, and `RequestExecutor` already covers first-request/no-
  wait and subsequent-request/provider-pacing behavior.

- Token Price Aggregation Price-0 through Price-5 is implemented in the working tree. `client.token.getPriceHistory()` supports latest, one UTC date, and inclusive UTC ranges through default Binance, OKX, Coinbase, and GeckoTerminal adapters.
- The price path is independent of credential-based blockchain execution. It uses no API key or environment key, has direct and proxy-only routes, bounded retries, caller abort handling, partial result failures, and aggregate `PRICE_DATA_UNAVAILABLE` behavior.
- Provider-local schema, mapper, error classifier, and deterministic fixtures exist for every price provider. Fixtures cover market selection, UTC ordering/deduplication, range chunking, missing dates, Gecko ambiguity and quote-side resolution, direct/proxy-only, retry, timeout, abort, partial/all failures, and sensitive failure redaction.
- Official API semantics were rechecked. The implementation and `TOKEN_PRICE_UPGRADE.md` record the only material correction: OKX uses `bar=1Dutc` rather than `1D` to honor the SDK UTC-day contract. GeckoTerminal requests `currency=usd` and the resolved `token=base|quote` side.
- Focused commits remain pending because Git user.name and user.email are unset; no identity will be fabricated and no push will be made.

- Work Packages 10 and 11 are complete: list `pageSize` now accepts 1–10,000; provider capability filtering enforces Moralis 100, Alchemy ERC-20 1,000 per stream, and Etherscan 10,000. Alchemy both direction returns the full two-stream union with an Alchemy-pinned dual cursor. `fullData: true` makes Etherscan the only candidate and defaults an omitted page size to 10,000; it remains cursor-paginated and is part of the cursor fingerprint.
- API-only chain additions are implemented: `address.getTransactionsByBlockRange`
  consumes provider cursors internally, and `chain.getLatestBlockNumber` /
  `getBlockNumberByTimestamp` use Etherscan's indexed block API. Alchemy is not
  eligible for native balance because that would require `eth_getBalance`.
  No new SDK path calls JSON-RPC or a provider RPC proxy.
- `address.getInternalNativeTransfersByBlockRange` and
  `address.getBeaconWithdrawalsByBlockRange` are also indexed Etherscan account
  API operations. They have bounded pagination, provider-local schemas/mappers
  and fixture-backed tests; no JSON-RPC fallback is permitted.
- `scripts/live-config.mjs` now supports both labelled grouped values and conventional provider-named `NAME=value` lines in `.env.key`, without logging the values.

- Architecture status: Accepted for v0.1 implementation.
- Source status: Work Packages 1 through 11 are complete, including Moralis, Alchemy single- and both-direction ERC-20 pages, public client composition, proxy-only/mixed routing, and package smoke coverage.
- Live smoke status: Alchemy balance, single-direction ERC-20 pagination, and both-direction two-page pagination succeeded. The latest Alchemy both-direction request returned 10 items for `pageSize: 5` on each of its two streams, with an Alchemy-pinned cursor continuing successfully to another 10-item page. The supplied Etherscan proxy failed as `PROXY_ERROR`; Etherscan direct operations returned normalized `REQUEST_TIMEOUT`. Moralis balance and transaction pagination succeeded; Moralis ERC-20 observed retryable `PROVIDER_UNAVAILABLE`. No secrets or cursors were printed.
- Documentation status: Domain, transport, redaction, provider contract, cursor, capability routing, pools, retry, executor, all three provider adapters, public composition, live config, and package behavior are recorded.
- Git status: The repository still has no configured Git `user.name` or `user.email`; no author identity was fabricated and no push was made.
- Current workflow gate: Work Package 11 is complete; release decisions and Git identity remain unresolved.

## Pending Tasks

1. Resolve release-only decisions: npm package name and scope, license, ownership, supported Node LTS range, and publishing workflow.
2. Configure the repository Git identity, then create focused conventional commits without pushing.
3. Before publishing, recheck current official provider/API and toolchain documentation.

## Next Actions

1. Resolve the open release questions before publishing.
2. Keep the live smoke run opt-in and rerun it only with bounded requests when provider behavior or credentials change.

## Risks

- Provider products and chain/plan matrices change independently. Capability fixtures and official links must be rechecked during adapter implementation.
- Etherscan chain support and free-tier availability are different concepts; plan restriction must not be reported as unsupported chain. Live requests in this environment currently time out.
- Etherscan's 10,000-record request encoding and routing are covered by deterministic tests, but the current network environment timed out before an upstream large-page response could be observed. Rerun the bounded `fullData` live smoke through a known-working route before claiming live Etherscan throughput.
- Alchemy asset transfers cannot safely masquerade as complete transactions. ADR-022 expands only ERC-20 transfer direction support; normal transaction history remains ineligible.
- Provider-specific no-result responses can resemble logical errors, especially Etherscan HTTP 200 envelopes; the Etherscan adapter now handles its documented list messages explicitly.
- Credential rotation can amplify throttling if the real quota is account-, IP-, or chain-wide.
- Axios can inherit environment proxy settings unless every direct attempt explicitly sets `proxy: false`.
- Cursors can become a secret/data leak or denial vector unless strictly bounded and validated.
- TypeScript 7 and ESLint 10 are recent; TypeScript ESLint and tsup declaration bundling are currently incompatible and have documented bootstrap workarounds.
- Focused Work Package 1 through Work Package 6 commits are blocked solely by the missing local Git author identity.
- Work Package 3's transport boundary intentionally does not classify provider payloads; provider adapters and execution own those semantics.
- Cursor provider configuration IDs must change when a configured provider's semantic endpoint/configuration changes; credentials and proxy values never enter cursor state.
- `requestPolicy.allowDirect` is explicit and defaults to `true`; setting it to `false` requires a usable configured proxy route.
- Moralis may return transient HTTP 425 responses under live load; the adapter classifies them as retryable provider unavailability.
- The public package name remains a private bootstrap placeholder until release decisions are made.

## Unknown Questions

- What npm package name and scope should be used? `evm-data-sdk` is a private bootstrap placeholder and must be replaced before publishing.
- Which license should be applied?
- Is the custom provider interface a supported v0.1 API or explicitly experimental?
- Should Node.js 22 be supported in addition to Node.js 24 after smoke testing?
- What conservative default pacing should apply when a user does not provide provider-plan limits?
- Does the owner prefer only the six proposed built-in chains for v0.1, or a smaller launch set of Ethereum and BNB Smart Chain?

# Terra Implementation Queue

## Working Rules for Terra

- Read `Agent.md` and all six documents before each work package.
- Work on exactly one package at a time. Do not begin a later package when the current acceptance criteria fail.
- Before editing, report the current workflow step, files to change, reason, and expected impact.
- Preserve the architecture. If an upstream API or toolchain fact contradicts it, stop implementation, update the documentation proposal, and request approval for the change.
- Use official provider documentation and fixture-driven tests. Do not use provider SDK dependencies.
- Keep new abstractions limited to the named boundaries. Do not add `utils`, `BaseProvider`, dependency injection containers, caches, background health checks, or automatic ranking.
- At the end of each package, run its checks, update this file, and create one focused conventional commit. Never push.

## Work Package 0: Record Architecture Approval

**Status:** Completed from the owner's explicit approval in the current request.

**Purpose:** Open the Step 4 gate without changing behavior.

**Files:** `Agent.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, this file.

**Actions:**

- Record the owner's exact approval date and any approved amendments.
- Change applicable statuses from `Proposed` to `Accepted`.
- Resolve contradictions across documents before creating source files.

**Acceptance:** All documents describe one architecture and explicitly allow implementation.

**Commit:** `docs: approve v0.1 architecture baseline`

## Work Package 1: Toolchain Bootstrap

**Status:** Completed. `pnpm check` and package smoke verification pass.

**Purpose:** Create a reproducible empty library build before domain behavior.

**Files:**

- `package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `tsconfig.json`
- `tsconfig.build.json`
- `tsup.config.ts`
- `eslint.config.js`
- `vitest.config.ts`
- `.gitignore`
- `.npmignore` or package `files` configuration
- `src/index.ts`
- minimal package smoke-test scripts/directories

**Actions:**

- Verify toolchain version compatibility using official release/package metadata.
- Configure strict TypeScript, ESM/CJS/declarations/source maps, flat ESLint, and Vitest.
- Add only documented dependencies. Runtime dependencies are Axios and Zod.
- Export no fake runtime API. A minimal empty named surface is acceptable until later packages.

**Tests:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm test:package`.

**Acceptance:** `pnpm check` runs from a clean install; packed ESM/CJS/TypeScript consumers load; tarball contents are narrow.

**Commit:** `chore: bootstrap TypeScript SDK toolchain`

## Work Package 2: Domain Contracts and Chain Registry

**Status:** Completed. Domain and chain unit tests pass without network access.

**Purpose:** Implement stable data semantics without HTTP or providers.

**Files:**

- `src/domain/chains.ts`
- `src/domain/configuration.ts`
- `src/domain/errors.ts`
- `src/domain/models.ts`
- `src/domain/operations.ts`
- `src/domain/pagination.ts`
- `src/chains/builtinChains.ts`
- `src/chains/ChainRegistry.ts`
- `src/index.ts` public contract exports
- `tests/unit/domain.test.ts`
- `tests/unit/chain-registry.test.ts`
- matching unit tests

**Actions:**

- Implement public models and error codes exactly as specified.
- Implement six immutable built-in chain definitions and custom-chain merge validation.
- Normalize aliases while retaining numeric chain IDs as canonical.
- Validate addresses, page sizes, filters, and request policy shapes.
- Keep provider response types out of this package.

**Tests:** Alias/ID resolution, duplicate aliases/IDs, custom routes, immutable output, invalid addresses, precision strings, null semantics, and error fields.

**Acceptance:** No network dependency; all domain/chain tests pass; no blockchain quantity is typed as `number`.

**Commit:** `feat: define domain contracts and chain registry`

## Work Package 3: Transport, Redaction, and Provider Contract

**Status:** Completed. `pnpm check` passes; transport and contract tests are fixture-free and network-independent.

**Purpose:** Establish one safe HTTP attempt boundary that adapters can use.

**Files:**

- `src/transport/HttpTransport.ts`
- `src/transport/AxiosHttpTransport.ts`
- `src/providers/DataProviderAdapter.ts`
- responsibility-specific redaction module under `src/transport/` or `src/domain/`
- matching unit/contract tests

**Actions:**

- Implement normalized request/response and transport error shapes.
- Implement timeout and `AbortSignal` propagation without retries.
- Use `proxy: false` for direct Axios attempts and explicit parsed HTTP(S) proxy objects for proxied attempts.
- Disable or tightly constrain redirects so auth cannot cross hosts/protocol downgrade.
- Implement secret-aware sanitization for query keys, headers, proxy userinfo, Axios errors, and nested causes.
- Define the custom adapter contract and one-attempt context.

**Tests:** Success/non-2xx body access, timeout, abort, connect failure, proxy configuration, environment proxy isolation, redirects, and all redaction paths.

**Acceptance:** Transport never decides retries or provider semantics; no test snapshot contains a secret.

**Commit:** `feat: add safe HTTP transport boundary`

## Work Package 4: Cursor Codec and Capability Router

**Status:** Completed. `pnpm check` passes; cursor and router tests are deterministic and network-independent.

**Purpose:** Make pagination identity and provider eligibility deterministic before resilience loops.

**Files:**

- `src/execution/cursorCodec.ts`
- `src/execution/ProviderRouter.ts`
- matching tests

**Actions:**

- Implement versioned base64url JSON cursors with a strict size limit and schema.
- Compute a deterministic semantic-query fingerprint.
- Reject changed operation, chain, provider configuration, direction, token filter, block range, order, or page size.
- Route by configured priority only after exact capability checks.
- Pin continuation candidates to one provider.

**Tests:** Round trip, corrupt/oversized/unknown version, query mismatch, provider removal, capability predicates, deterministic order, and no-eligible-provider errors.

**Acceptance:** Cursors contain no secrets/results/raw URLs; router performs no HTTP and owns no retries.

**Commit:** `feat: add capability routing and opaque cursors`

## Work Package 5: Pools, Retry Policy, and Request Executor

**Status:** Completed. `pnpm check` passes; execution tests are deterministic, network-independent, and bounded.

**Purpose:** Implement bounded resilience independently of real provider payloads.

**Files:**

- `src/execution/CredentialPool.ts`
- `src/execution/ProxyPool.ts`
- `src/execution/RetryPolicy.ts`
- `src/execution/RequestExecutor.ts`
- optional narrow clock/random interfaces in `src/execution/`
- matching deterministic tests

**Actions:**

- Implement concurrency-safe fair leases and scoped outcome reporting.
- Distinguish invalid keys, rate cooldown, plan restriction, proxy failure, transient provider failure, invalid payload, and caller cancellation.
- Implement cancellation-aware backoff, `Retry-After`, jitter, per-attempt timeout, overall deadline, and one total attempt counter.
- Allow first-page/scalar provider fallback; forbid continuation fallback.
- Emit sanitized structured attempt events through an optional callback; default is silent.

**Tests:** Exact scripted attempt sequences, concurrent leases, cooldown expiry with fake time, abort during sleep, deadline exhaustion, direct-route policy, invalid-key disable, 429 behavior, fallback order, and continuation stop.

**Acceptance:** No nested retry counts; every loop has an attempt and time bound; fake adapters prove behavior without network.

**Commit:** `feat: implement bounded request execution`

## Work Package 6: Etherscan Vertical Slice

**Status:** Completed. `pnpm check` passes with fixture-backed adapter coverage.

**Purpose:** Implement the first complete provider using the unified V2 API.

**Files:** `src/providers/etherscan/*`, Etherscan fixtures and tests, chain capability metadata where required.

**Actions:**

- Implement `txlist`, `balance`, and `tokentx` against `https://api.etherscan.io/v2/api` with decimal `chainid`.
- Add strict-enough response schemas that tolerate unrelated future fields.
- Map all public quantities to decimal strings and timestamps to ISO UTC.
- Implement page/offset cursor state and direction filtering.
- Classify no-results, invalid key, invalid chain, free-plan restriction, shared quota, rate limit, query timeout/busy, malformed payload, and selected HTTP errors.

**Fixtures:** Success per operation, empty list, last page, contract creation, reverted/unknown status, missing optional data, every error class, malformed HTTP 200 payload.

**Acceptance:** No legacy explorer API host appears in source; authenticated URLs are redacted; adapter performs one attempt; contract tests pass.

**Optional live check:** One low-volume Ethereum request per operation; BSC only when the test account plan permits it.

**Commit:** `feat: add Etherscan V2 adapter`

## Work Package 7: Moralis Vertical Slice

**Status:** Completed. Fixture-backed transactions, balances, transfers, cursor behavior, errors, and redaction pass.

**Purpose:** Add a semantically equivalent fallback for all three public operations.

**Files:** `src/providers/moralis/*`, Moralis fixtures and tests, chain capability metadata where required.

**Actions:**

- Implement raw `GET /{address}` transactions, native `GET /{address}/balance`, and `GET /{address}/erc20/transfers` under `/api/v2.2`.
- Use registry-provided chain values and `X-API-Key`.
- Map raw amounts rather than formatted decimals.
- Preserve provider cursor pagination and enforce fixed initial query/page size.
- Classify endpoint-specific 404, auth, rate, validation, provider failure, and malformed payload behavior.

**Fixtures:** Same semantic cases as Etherscan plus Moralis cursor snapshot/terminal behavior and extra enriched fields ignored safely.

**Acceptance:** Raw transactions, not enriched wallet activity, feed the transaction model; all response cursors are wrapped by the SDK cursor; contract tests pass.

**Optional live check:** One low-volume Ethereum request per operation.

**Commit:** `feat: add Moralis data adapter`

## Work Package 8: Alchemy Scoped Vertical Slice

**Status:** Completed. Directional ERC-20 page-key transfers and native balances pass; transactions and both-direction transfers are rejected by capability routing.

**Purpose:** Add Alchemy only where its endpoints meet v0.1 semantics.

**Files:** `src/providers/alchemy/*`, Alchemy fixtures and tests, chain route metadata where required.

**Actions:**

- Implement network-specific endpoint resolution with `Authorization: Bearer` header authentication.
- Implement latest `eth_getBalance` and convert hex quantity to a decimal string.
- Implement `alchemy_getAssetTransfers` for `erc20` and exactly one requested direction.
- Support `pageKey`; reject `direction: "both"` at capability routing without a network request.
- Classify HTTP errors and JSON-RPC error envelopes, including 429.
- Do not implement transactions, N+1 hydration, or dual-stream merging.

**Fixtures:** Balance success/error, incoming/outgoing pages, null/terminal page key, metadata present/absent, unsupported request features, malformed JSON-RPC result, HTTP/JSON-RPC throttling.

**Acceptance:** API keys never enter URLs; Alchemy is ineligible for normal transactions and both-direction transfers; contract tests pass.

**Optional live check:** One Ethereum balance and one small directional ERC-20 request.

**Commit:** `feat: add scoped Alchemy adapter`

## Work Package 9: Public Client Integration and Release Hardening

**Status:** Completed. `EvmDataClient`, address/token services, package README, ESM/CJS/type smoke, and proxy-mode composition tests pass.

**Purpose:** Compose the tested layers into the documented public SDK and validate the package as a user would.

**Files:**

- `src/client/EvmDataClient.ts`
- `src/services/AddressService.ts`
- `src/services/TokenService.ts`
- `src/index.ts`
- public API integration tests
- package smoke projects/scripts
- README and documentation updates required by actual exports
- Changesets configuration

**Actions:**

- Validate configuration and compose registry, adapters, pools, router, executor, transport, and services without network work in constructors.
- Expose exact public operations, types, errors, chain extension types, telemetry types, and custom provider contract.
- Keep all internal classes not intended for users out of package exports.
- Exercise provider fallback end to end through fake transports.
- Pack and consume ESM, CommonJS, and declarations.
- Add minimal usage README after actual API names are compile-tested.

**Tests:** Full `pnpm check`, clean-worktree check, tarball inspection, examples typecheck, no import-time timers/network/environment reads, secret scan.

**Acceptance:** Every v0.1 acceptance criterion in `SPEC.md` passes; documentation matches exports and defaults; no release-only unknown is silently guessed.

**Commit:** `feat: complete v0.1 SDK public API`

# Final Review Queue

After Work Package 9, perform Step 5 before adding any v0.2 feature:

1. Trace dependency direction and ensure provider directories do not import each other.
2. Review `RequestExecutor` complexity; split only if responsibilities are genuinely mixed.
3. Verify every adapter performs one attempt and every loop is bounded/cancellable.
4. Audit public types for precision, `null` semantics, and provider leakage.
5. Audit logs, errors, cursors, snapshots, and tarball for keys/proxy credentials.
6. Compare all adapter behavior with current official documentation.
7. Run `pnpm check` and opt-in live smoke tests.
8. Resolve npm name, license, ownership, Node support, and publishing workflow before release.
9. Update this handoff and create a focused review/refactor commit if changes were needed.
