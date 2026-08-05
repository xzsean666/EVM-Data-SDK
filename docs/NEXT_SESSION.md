# Current Progress

Last updated: 2026-08-05

Workflow state: Step 3 complete; Step 4 is blocked pending owner approval.

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

## Current State

- Architecture status: Proposed, awaiting explicit owner approval.
- Source status: No `src/`, tests, `package.json`, or lockfile exists by design.
- Documentation status: Initial architecture baseline complete.
- Git status: Documentation milestone is staged and ready for review; the commit attempt is blocked because this repository has no Git author identity configured. No push is authorized.
- Current workflow gate: Do not start Work Package 1 until the owner approves `SPEC.md`, `ARCHITECTURE.md`, and proposed ADRs.

## Pending Tasks

1. Obtain explicit owner approval or requested architecture changes.
2. Resolve the TypeScript 7, tsup, ESLint 10, and TypeScript ESLint compatibility set before creating the lockfile.
3. Execute Work Packages 1 through 9 in order.
4. Perform the Step 5 architecture and maintainability review.
5. Resolve release-only decisions: npm package name, license, ownership, supported Node LTS range, and publishing workflow.

## Next Actions

1. Owner reviews the architecture, especially the Alchemy partial-capability decision, Node-only v0.1 boundary, six built-in chains, and provider-pinned cursors.
2. After approval, change architecture/ADR status to `Accepted` and assign Terra Work Package 1 only.

## Risks

- Provider products and chain/plan matrices change independently. Capability fixtures and official links must be rechecked during adapter implementation.
- Etherscan chain support and free-tier availability are different concepts; plan restriction must not be reported as unsupported chain.
- Alchemy asset transfers cannot safely masquerade as complete transactions. Expanding its capability without a new decision risks semantic corruption.
- Provider-specific no-result responses can resemble logical errors, especially Etherscan HTTP 200 envelopes.
- Credential rotation can amplify throttling if the real quota is account-, IP-, or chain-wide.
- Axios can inherit environment proxy settings unless every direct attempt explicitly sets `proxy: false`.
- Cursors can become a secret/data leak or denial vector unless strictly bounded and validated.
- TypeScript 7 and ESLint 10 are recent; their surrounding ecosystem compatibility must be proven rather than assumed.

## Unknown Questions

- What npm package name and scope should be used?
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

**Purpose:** Open the Step 4 gate without changing behavior.

**Files:** `Agent.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/DECISIONS.md`, this file.

**Actions:**

- Record the owner's exact approval date and any approved amendments.
- Change applicable statuses from `Proposed` to `Accepted`.
- Resolve contradictions across documents before creating source files.

**Acceptance:** All documents describe one architecture and explicitly allow implementation.

**Commit:** `docs: approve v0.1 architecture baseline`

## Work Package 1: Toolchain Bootstrap

**Purpose:** Create a reproducible empty library build before domain behavior.

**Files:**

- `package.json`
- `pnpm-lock.yaml`
- `tsconfig.json`
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

**Tests:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, initial `pnpm test:package`.

**Acceptance:** `pnpm check` runs from a clean install; packed ESM/CJS/TypeScript consumers load; tarball contents are narrow.

**Commit:** `chore: bootstrap TypeScript SDK toolchain`

## Work Package 2: Domain Contracts and Chain Registry

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
