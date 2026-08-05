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

**Status:** Accepted

**Date:** 2026-08-05

**Decision:** Use Alchemy for latest native balance and single-direction ERC-20 transfers. Do not use it for normal transaction history or both-direction transfer pagination in v0.1.

**Reason:** `alchemy_getAssetTransfers` is an asset activity stream, not a complete transaction envelope list. A both-direction wallet query requires a correct ordered merge of two cursor streams.

**Alternatives considered:** Map transfers to transactions with missing fields; hydrate each hash with N+1 JSON-RPC calls; merge two streams with an unbounded cursor buffer.

**Trade-offs:** Alchemy provides less v0.1 fallback coverage. The public contract remains honest and can add a composite cursor later through a separate decision.

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

## Open Decisions Requiring Owner Input

These are not architecture blockers for writing code until their named milestone, but they block release where noted:

- Final npm package name and whether it is scoped.
- License.
- Public repository URL and npm ownership.
- Whether support should include Node.js 22 in addition to Node.js 24; decide after package smoke tests.
- Whether custom provider adapters are experimental or part of the supported v0.1 public API.
- Default provider request pacing when callers do not state their plan. The safe proposal is conservative per-provider defaults with configuration overrides.
