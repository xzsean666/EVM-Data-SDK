# Architecture Decisions

Version: 0.2.0

The owner approved the architecture baseline in the 2026-08-05 implementation request. Decisions below are accepted for v0.1; ADR-018 through ADR-020 govern the implemented v0.2 price upgrade.

## ADR-001: Node.js-first v0.1 runtime

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Target Node.js, using Node.js 24 LTS as the development baseline. Do not claim browser support in v0.1.

**Reason:** Optional proxy routing and backend API keys are primary requirements. A Node-first boundary avoids browser secret exposure and incompatible proxy behavior.

**Alternatives considered:** Universal browser/Node package; separate browser entry point.

**Trade-offs:** Frontend applications need a backend. A browser build can be added later after its security and transport contract is designed.

## ADR-002: Capability-aware provider routing

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Filter providers by chain, operation, and request features before applying caller-configured priority.

**Reason:** Similar endpoint names do not guarantee equivalent data. Alchemy asset transfers, for example, are not full normal transaction history.

**Alternatives considered:** Require every adapter to implement every method; call providers in priority order and discover support through errors.

**Trade-offs:** Capability metadata adds explicit maintenance, but prevents silent semantic degradation and unnecessary paid requests.

## ADR-003: EIP-155 chain ID is canonical

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Resolve numeric IDs and friendly aliases through an immutable chain registry; return `chainId` in results.

**Reason:** Provider slugs and explorer domains differ, while EIP-155 IDs identify EVM networks consistently.

**Alternatives considered:** String-only chain names; provider-specific network enum in public APIs; automatic remote chain discovery.

**Trade-offs:** Built-in route metadata must be maintained. Explicit custom chain definitions provide extension without nondeterministic runtime discovery.

## ADR-004: Etherscan V2 unified endpoint only

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Call `https://api.etherscan.io/v2/api` with `chainid` and an Etherscan key for all Etherscan-supported chains.

**Reason:** V1 and explorer-specific API hosts were deprecated on 2025-08-15. V2 is the current multichain contract.

**Alternatives considered:** A URL map for Etherscan, BscScan, PolygonScan, BaseScan, and other V1 hosts.

**Trade-offs:** Users need an Etherscan V2 key, and some chains require paid plans. The adapter gains one stable routing model.

## ADR-005: Provider-local schemas and mappers

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Keep each provider's request encoding, response schema, error classifier, and mapper inside its provider directory.

**Reason:** Those concerns evolve together and are understandable without following a shared normalization chain across the repository.

**Alternatives considered:** Shared `normalizer` and universal `BaseProvider`; cross-provider raw response types.

**Trade-offs:** Small mapping patterns may repeat. The duplication is preferable to hidden coupling between unrelated upstream formats.

## ADR-006: Decimal strings for on-chain integers

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Public quantities and block/index values are canonical base-10 strings. Internal conversion may use `BigInt`.

**Reason:** JavaScript numbers cannot safely represent arbitrary EVM integer values, and JSON cannot encode `bigint` directly.

**Alternatives considered:** `number`; public `bigint`; provider-native hex strings.

**Trade-offs:** Consumers parse strings when doing arithmetic. In return, results are JSON-safe and consistent across decimal/hex providers.

## ADR-007: Provider-pinned SDK cursors

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Return a versioned opaque SDK cursor containing provider paging state and a query fingerprint. Continuation stays on the original provider.

**Reason:** Etherscan offsets, Alchemy page keys, and Moralis snapshot cursors are not interchangeable. Switching providers after page one can create duplicates or gaps.

**Alternatives considered:** Expose raw provider cursors; use only numeric page/offset; fall back across providers on every page.

**Trade-offs:** A continuation can fail while another provider is healthy. Correctness and deterministic snapshots take priority over availability after page one.

## ADR-008: Central bounded execution policy

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** `RequestExecutor` owns one shared attempt/time budget across retries, keys, proxies, and provider fallback. Adapters execute once.

**Reason:** Nested retry loops multiply requests, violate deadlines, complicate cancellation, and can amplify provider outages.

**Alternatives considered:** Adapter-specific retries; Axios retry interceptors plus provider fallback; unlimited retry until success.

**Trade-offs:** The executor has meaningful orchestration responsibility, so its state machine needs strong deterministic tests.

## ADR-009: Credential rotation is scoped scheduling, not quota avoidance

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Associate keys with one provider configuration, lease them fairly, disable invalid keys, and apply cooldowns using provider evidence. Do not assume rotation increases quota.

**Reason:** Providers may enforce key-, application-, account-, IP-, chain-, or community-level limits. Blind round-robin behavior can make throttling worse or conflict with provider terms.

**Alternatives considered:** Stateless round robin on every request; rotate on every failure.

**Trade-offs:** State and clocks require concurrency tests. Behavior is more accurate and observable.

## ADR-010: Proxy pool is a transport feature

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Support explicitly configured HTTP(S) proxies in Node.js. Penalize/rotate them only on proxy or connectivity evidence. Disable Axios environment proxy discovery for deterministic direct attempts.

**Reason:** Provider auth, plan, validation, and most rate-limit failures are not proxy failures. Implicit environment proxies violate explicit dependency behavior.

**Alternatives considered:** Rotate proxy after any error; use `HTTP_PROXY` automatically; include SOCKS in v0.1.

**Trade-offs:** Users must configure proxies explicitly. SOCKS and custom agents need later reviewed integrations.

## ADR-011: Passive health, deterministic priority

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Use configured provider order plus passive, bounded cooldowns. Do not run background probes or automatic ranking in v0.1.

**Reason:** Health probes consume quotas and add timers/lifecycle behavior. A small SDK should remain inactive when the application is inactive.

**Alternatives considered:** Periodic health checks; latency/health score routing; random load balancing.

**Trade-offs:** Routing does not continuously optimize latency. The behavior is deterministic, cheaper, and simpler to reason about.

## ADR-012: Alchemy has partial v0.1 capabilities

**Status:** Superseded by ADR-022

**Date:** 2026-08-05

**Decision:** Historical decision: use Alchemy for latest native balance and single-direction ERC-20 transfers. Do not use it for normal transaction history or both-direction transfer pagination in v0.1.

**Reason:** `alchemy_getAssetTransfers` is an asset activity stream, not a complete transaction envelope list. A both-direction wallet query requires a correct ordered merge of two cursor streams.

**Alternatives considered:** Map transfers to transactions with missing fields; hydrate each hash with N+1 JSON-RPC calls; merge two streams with an unbounded cursor buffer.

**Trade-offs:** Superseded: ADR-022 adds the bounded composite cursor while preserving the restriction on normal transaction history.

## ADR-013: Axios transport with explicit proxy control

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Use Axios 1.x behind an internal `HttpTransport` interface. The SDK, not interceptors, owns retries.

**Reason:** Axios provides cancellable Node HTTP, timeout/headers/body access, and explicit HTTP(S) proxy support while remaining easy to fake at the internal boundary.

**Alternatives considered:** Native `fetch`; `undici` plus `ProxyAgent`; provider SDK packages.

**Trade-offs:** Axios is a runtime dependency and can inherit environment proxy behavior unless explicitly disabled. The adapter boundary limits its reach.

## ADR-014: Zod validates all external boundaries

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Use Zod for configuration, public request boundaries, cursor decoding, and provider response envelopes.

**Reason:** TypeScript types do not validate runtime network data. Provider schema failures must be explicit and normalized.

**Alternatives considered:** Manual type guards; unchecked casts; a separate schema library per provider.

**Trade-offs:** Runtime validation adds dependency and CPU cost. The selected responses are small/page-bounded and correctness is worth the cost.

## ADR-015: Typed exceptions are the public failure model

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Public methods reject with `EvmDataError` and stable error codes. They do not return a mixture of `null`, provider errors, or result unions.

**Reason:** A consistent thrown error fits async TypeScript APIs and allows normalized retryability/provider context.

**Alternatives considered:** `Result<T, E>` return values; raw Axios/provider exceptions; `null` for all unavailable data.

**Trade-offs:** Consumers must use exception handling. Stable codes keep control flow independent of error message text.

## ADR-016: No cache in v0.1

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Do not add in-memory, Redis, or persistent response caching in v0.1.

**Reason:** Cache identity, chain reorganization/finality, latest-balance freshness, cursor snapshots, and failure caching need operation-specific semantics that are not part of the initial product.

**Alternatives considered:** Simple TTL cache around provider calls; mandatory Redis.

**Trade-offs:** Repeated requests consume upstream quota. The initial correctness and extension boundaries remain clear.

## ADR-017: Explicit direct-route policy

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Add `requestPolicy.allowDirect`, defaulting to `true`; when set to `false`, the executor may use only explicitly configured HTTP(S) proxies and must not silently bypass them.

**Reason:** Proxy routing is caller policy, not an implicit environment or failure fallback. A clear direct-route switch lets deployments require egress through an approved proxy without changing transport behavior.

**Alternatives considered:** Always allow direct fallback; infer policy from whether the proxy list is empty; read `HTTP_PROXY`/`HTTPS_PROXY` from the environment.

**Trade-offs:** A required-proxy configuration can fail when every configured proxy is unavailable. This preserves the caller's network boundary and avoids accidental credential egress.

## ADR-018: Price aggregation is a parallel unauthenticated execution path

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Token price history uses `TokenPriceAggregator`, `PriceProviderRouter`, `PriceRequestExecutor`, and `TokenPriceProviderAdapter`, independently of blockchain `DataProviderAdapter`, `CredentialPool`, and the credential-based `RequestExecutor`.

**Reason:** Public market-data endpoints have distinct identity, quote, partial-success, and no-key semantics. Forcing them through credential rotation would obscure that contract and couple unrelated fallback behavior.

**Alternatives considered:** Add price methods to blockchain adapters; extend the credential executor with nullable credentials; query providers serially.

**Trade-offs:** A small bounded execution path is separate, while transport, proxy pooling, clock, abort, retry-wait, telemetry, and redaction are reused.

## ADR-019: Preserve provider quote and identity

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Return one result per successful source in configured order. Binance and OKX remain USDT Spot markets; Coinbase and GeckoTerminal remain USD sources. GeckoTerminal returns resolved network, token contract, pool, and token-side context. No quote conversion, median, filling, cache, or cross-provider substitution occurs.

**Reason:** Exchange symbols and on-chain contracts are not globally equivalent identities. Quote conversion or gap filling would create values that no provider supplied.

**Alternatives considered:** Normalize every source to USD; select the first healthy source; return zero or prior close for gaps; dynamically rank sources.

**Trade-offs:** Consumers make quote-normalization and consensus decisions explicitly. Partial results are more verbose but retain provenance and failure visibility.

## ADR-020: UTC daily bars are a public contract

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Price input/output uses UTC `YYYY-MM-DD`, ascending dates, close as canonical price, and a non-final current UTC bucket. OKX requests `1Dutc`; GeckoTerminal requests USD OHLCV for the resolved base or quote token side.

**Reason:** Exchange-local daily buckets or an implicit pool base-token lookup can mislabel a UTC calendar date or requested asset.

**Alternatives considered:** Provider-local day boundaries; timestamp conversion after retrieval; always query a pool base token.

**Trade-offs:** Provider-specific request parameters remain explicit and require boundary fixtures.

## ADR-021: Page-size-aware list routing and Etherscan-only full-data mode

**Status:** Accepted

**Date:** 2026-08-06

**Decision:** Accept list `pageSize` values from 1 through 10,000. Treat each built-in provider's documented/verified list-page capacity as a capability: Moralis 100, Alchemy ERC-20 transfers 1,000 per stream, and Etherscan 10,000. Add `fullData: true` to list requests; it restricts candidates to Etherscan and defaults an omitted page size to 10,000. It does not collect an unbounded history in one SDK invocation.

**Reason:** A single global 100-record validation ceiling prevents callers from using compatible provider capacities and sends no meaningful routing signal. The owner needs predictable 1,000-record Alchemy/Etherscan fallback and a deliberately Etherscan-only high-capacity mode.

**Alternatives considered:** Keep a global 100-record ceiling; silently clamp a request per provider; use a page size of 10,000 with every configured adapter; make `fullData` recursively fetch an unbounded history.

**Trade-offs:** Pagination remains provider-pinned and callers still follow `nextCursor`; no cross-provider page mixing or surprise fan-out is introduced. Page size becomes part of provider eligibility and cursor identity, so changing it or switching full-data mode invalidates an existing cursor.

## ADR-022: Alchemy both-direction ERC-20 uses a bounded composite cursor

**Status:** Accepted

**Date:** 2026-08-06

**Decision:** Support Alchemy `direction: "both"` by issuing one `toAddress` and one `fromAddress` Transfers API request with identical fixed filters, then merge their complete returned pages by block number and documented `uniqueId`. A self-transfer is emitted from the outgoing stream only, making the two streams disjoint even when their page keys advance at different rates. The Alchemy SDK cursor holds two provider-local stream states (page key and exhausted flag), never transfer items, keys, headers, or an Etherscan/Moralis cursor. `pageSize` applies per stream, so this special mode can return up to twice the public size.

**Reason:** Applications need the same public direction options across built-in ERC-20 providers. Alchemy requires two requests because the Transfers API accepts one address-direction filter per request.

**Alternatives considered:** Continue to reject both direction; return two provider-specific pages; collect an unbounded full history; store unreturned transfer items in the cursor; switch to Etherscan on continuation.

**Trade-offs:** A single Alchemy both-direction adapter attempt makes two upstream calls rather than one and can return up to twice as many records as a single-direction page. Ordering is deterministic by block number then `uniqueId` within each composite page; global ordering across independent streams would require buffering unreturned transfers in the cursor, which this design deliberately avoids. A cursor remains Alchemy-pinned and changing providers, page size, filters, or mode is invalid.

## ADR-023: Advanced proxy uses a managed sing-box loopback runtime

**Status:** Accepted by owner on 2026-08-06

**Date:** 2026-08-06

**Decision:** Add an independent `advancedProxy.kind: "sing-box"` configuration that accepts only `vless://` and `ss://` URLs. On first actual use, a fixed-version platform binary is downloaded or reused from a verified cache, started with a generated loopback-only `mixed` inbound, and exposed to the existing execution/price paths as a local HTTP proxy. Keep the current explicit HTTP(S) proxy shape unchanged.

**Reason:** Axios cannot speak VLESS or Shadowsocks directly. A managed sing-box process provides one narrow translation boundary while preserving the existing transport, retry, proxy lease, and redaction contracts. Lazy download avoids npm install-time network side effects.

**Alternatives considered:**

- Add a SOCKS/VLESS implementation directly to Axios: rejected because it couples protocol parsing, transport agents, and process lifecycle to every provider adapter.
- Ship a binary in the npm package: rejected because of package size, platform matrix, native executable provenance, and release licensing/update concerns.
- Read `.env.key` or implicit proxy environment variables inside the SDK: rejected because configuration ownership and secret boundaries would become nondeterministic.
- Accept arbitrary sing-box JSON: rejected because TUN/system routing, LAN listeners, DNS, and unreviewed capabilities would escape the SDK's transport boundary.

**Trade-offs:** The SDK gains binary download, checksum, child-process, and cleanup complexity. sing-box may select among nodes internally, so the SDK observes one local route rather than one independently cooled route per URL. The feature is Node.js-only, opt-in, and makes no quota or censorship-evasion guarantee.

## ADR-024: Block-range ERC-20 reads use adaptive coverage windows

**Status:** Accepted by owner on 2026-08-06

**Date:** 2026-08-06

**Decision:** Add `getErc20TransfersByBlockRange` with a required wallet address and inclusive `startBlock`/`endBlock`; do not expose `pageSize` or raw cursors. The scanner owns a ledger of disjoint closed windows that must exactly partition the requested range. Each provider attempt uses its internal maximum page and ascending fresh block-range request. If an attempt cannot prove a window is terminal, the scanner discards that partial window response, splits the window at its `BigInt` midpoint, and re-queries the children without carrying any provider cursor/page state. Every window may try Etherscan, Alchemy, and Moralis in capability-aware priority order. A single dense block that no candidate can prove complete fails as stalled.

**Reason:** Provider page limits and range query timeouts make one request insufficient. Restarting a smaller closed range is safer than carrying heterogeneous provider cursor states, while a coverage ledger proves that changing provider between windows creates neither a gap nor an out-of-range result. A full response must never be advanced with `lastBlock + 1`, because that can lose the remaining transfers in a dense last block.

**Alternatives considered:**

- Expose `pageSize`/`nextCursor` and require callers to loop: rejected for this operation because the owner wants a range-only contract.
- Set `offset=10,000` once and assume a full page means the next block is `lastBlock + 1`: rejected because a page can end halfway through a block.
- Pin one provider and advance its internal page state: rejected because the requested design is fresh block-range queries and all three supported range APIs can be scheduled at the window boundary.
- Return a partial array on timeout: rejected because partial data cannot be mistaken for complete range coverage; return a typed incomplete error with a safe next block instead.

**Trade-offs:** A successful call may make more requests because overflowing windows are re-read after splitting, and it holds all records in memory. An explicit `maxRangeRecords` and maximum-window safety limit must fail rather than truncate or loop; a future async iterator can address very large ranges. Results can have multiple sources, so every transfer retains its provider and the aggregate exposes providers plus completed-window counts. Provider-specific support remains capability-gated: all three planned range adapters require fixture-backed boundary and terminal semantics before enablement.

### ADR-023: API-only chain data

**Status:** Accepted

**Decision:** The SDK and backend synchronization path use indexed provider
APIs only. Standard JSON-RPC methods, RPC URLs, and provider RPC proxy modules
are out of scope for user data. Transaction range pagination remains internal
to the SDK; finality lag is applied by the backend after an API height lookup.

**Reason:** Portfolio truth must be reproducible from the configured API data
source and must not create frequent backend RPC traffic. If a UI needs an
RPC-only field, the UI may read it separately without changing PostgreSQL
business truth.

**Trade-off:** Provider capability gaps must be solved with an indexed API
provider or explicit unavailable readiness state; the SDK must not silently
fall back to RPC.

### ADR-025: Historical ERC-20 snapshots use an explicit discovery set

**Status:** Accepted

**Date:** 2026-08-06

**Decision:** Use an indexed current-holdings result only to discover contracts
still held by a wallet. Union it with the caller's transfer-range contracts,
then request each exact opening-block value through an indexed API. Etherscan
uses one `tokenbalancehistory` read per contract; Moralis uses its REST wallet
ERC-20 balance endpoint with `to_block` and projects the complete response
onto the same explicit contract set. The public historical-balance operation
never claims to enumerate all historic wallet assets.

**Reason:** A wallet may have a nonzero opening balance without a transfer in
the chosen window, while a token sold to zero will not be present in current
holdings. The union covers both under standard ERC-20 transfer semantics while
remaining API-only and avoiding a product-wide token-catalog scan.

**Trade-off:** The documented Etherscan endpoints require Standard-or-higher
access and are capped at two calls per second. The API client serializes those
requests. If Etherscan is plan-restricted, the client may fall back to the
semantically compatible Moralis REST endpoint when configured; it never falls
back to Alchemy JSON-RPC or a node RPC endpoint. Moralis requires `to_block`
for current-holdings discovery, so the current implementation also requires an
available Etherscan indexed-height query to resolve that block.

### ADR-026: API-only transaction context uses Moralis nested logs

**Status:** Accepted

**Date:** 2026-08-06

**Decision:** The SDK exposes transaction context through Moralis Data API
`GET /transaction/{hash}` as an explicit caller operation. The normalized SDK
result contains the transaction envelope, receipt gas/status fields, and every
nested log. It accepts a bounded list of hashes and performs one validated
request per hash; it has no provider continuation cursor. The backend
portfolio/onboarding/action-parser path does not call this operation; a UI may
obtain and parse context on demand through its own frontend data source.
The public batch is capped at 20 hashes, and each client caches normalized
results for 60 seconds with in-flight coalescing; no refresh timer exists.

**Reason:** The endpoint is an indexed REST response with the exact log topics
and data required by protocol action parsing while preserving a useful SDK
capability for explicit callers. Alchemy balance/receipt methods and Etherscan
proxy endpoints are JSON-RPC semantics and violate the backend API-only
boundary.

**Trade-off:** Moralis is currently the only built-in provider with a verified
semantic match. If it is unavailable or plan-restricted, context remains
explicitly unavailable; the SDK does not silently use RPC or fabricate an
empty log list. The backend gives up automatic action-context enrichment in
exchange for avoiding high-volume server-side provider requests.

## Open Decisions Requiring Owner Input

These are not architecture blockers for writing code until their named milestone, but they block release where noted:

- Final npm package name and whether it is scoped.
- License.
- Public repository URL and npm ownership.
- Whether support should include Node.js 22 in addition to Node.js 24; decide after package smoke tests.
- Whether custom provider adapters are experimental or part of the supported v0.1 public API.
- Default provider request pacing when callers do not state their plan. The safe proposal is conservative per-provider defaults with configuration overrides.
