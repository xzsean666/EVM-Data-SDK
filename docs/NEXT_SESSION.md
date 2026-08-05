# Current Progress

Last updated: 2026-08-05

Workflow state: Step 5 review complete for Work Packages 1 through 9 and Price-0 through Price-5; release decisions and Git identity remain outside implementation scope.

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

- Token Price Aggregation Price-0 through Price-5 is implemented in the working tree. `client.token.getPriceHistory()` supports latest, one UTC date, and inclusive UTC ranges through default Binance, OKX, Coinbase, and GeckoTerminal adapters.
- The price path is independent of credential-based blockchain execution. It uses no API key or environment key, has direct and proxy-only routes, bounded retries, caller abort handling, partial result failures, and aggregate `PRICE_DATA_UNAVAILABLE` behavior.
- Provider-local schema, mapper, error classifier, and deterministic fixtures exist for every price provider. Fixtures cover market selection, UTC ordering/deduplication, range chunking, missing dates, Gecko ambiguity and quote-side resolution, direct/proxy-only, retry, timeout, abort, partial/all failures, and sensitive failure redaction.
- Official API semantics were rechecked. The implementation and `TOKEN_PRICE_UPGRADE.md` record the only material correction: OKX uses `bar=1Dutc` rather than `1D` to honor the SDK UTC-day contract. GeckoTerminal requests `currency=usd` and the resolved `token=base|quote` side.
- Focused commits remain pending because Git user.name and user.email are unset; no identity will be fabricated and no push will be made.

- Architecture status: Accepted for v0.1 implementation.
- Source status: Work Packages 1 through 9 are complete, including Moralis, scoped Alchemy, public client composition, proxy-only/mixed routing, and package smoke coverage.
- Live smoke status: Alchemy balance and directional ERC-20 pagination, Alchemy capability rejection, and Moralis balance and transaction pagination succeeded. Proxy-only and mixed routes were exercised for Etherscan, Alchemy, and Moralis; the latest run classified the supplied proxy's Etherscan connection failure as `PROXY_ERROR`, while Alchemy and Moralis proxy-only and mixed balance calls succeeded. Moralis ERC-20 also observed retryable `PROVIDER_UNAVAILABLE` from a live HTTP 425. Etherscan direct operations returned normalized `REQUEST_TIMEOUT`. No secrets or cursors were printed.
- Documentation status: Domain, transport, redaction, provider contract, cursor, capability routing, pools, retry, executor, all three provider adapters, public composition, live config, and package behavior are recorded.
- Git status: The repository still has no configured Git `user.name` or `user.email`; no author identity was fabricated and no push was made.
- Current workflow gate: Step 5 implementation review is complete. `pnpm check` passes with 125 tests and package smoke validation. Do not add further scope before release decisions are resolved.

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
- Alchemy asset transfers cannot safely masquerade as complete transactions. Expanding its capability without a new decision risks semantic corruption.
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
