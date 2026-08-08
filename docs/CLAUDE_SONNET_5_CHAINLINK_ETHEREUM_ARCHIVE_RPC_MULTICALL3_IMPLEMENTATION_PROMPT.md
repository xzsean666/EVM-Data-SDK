# Claude Sonnet 5 Implementation Prompt — Chainlink Historical Prices via Ethereum Archive RPC and Multicall3 Upgrade

Project ID: `chainlink-ethereum-archive-rpc-multicall3`

The text below is intended to be copied to Claude Sonnet 5 with access to this
repository. Its scope is exactly the upgrade documented in
`docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MULTICALL3_UPGRADE.md`.

```text
You are the implementation engineer for the EVM-Data-SDK repository at
/home/sean/git/EVM-Data-SDK.

Project: Chainlink Historical Prices via Ethereum Archive RPC and Multicall3 Upgrade
Project ID: chainlink-ethereum-archive-rpc-multicall3

Goal: implement the approved v0.4 proposal so a caller supplies one Ethereum
Mainnet block number and receives the historical Chainlink latestRoundData()
snapshot for every eligible built-in standard Crypto/USD token feed. There is
no token input. Use exact-block eth_call, a reusable public Multicall3 module,
multiple public Archive RPC endpoints, initialization-time health checks, and
random selection among healthy endpoints.

Mandatory first action:
1. Read Agent.md completely.
2. Then read, in Agent.md's required order, docs/SPEC.md,
   docs/ARCHITECTURE.md, docs/BUILD.md, docs/INTEGRATIONS.md,
   docs/DECISIONS.md, and docs/NEXT_SESSION.md completely.
3. Read docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MULTICALL3_UPGRADE.md and
   docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md completely.
4. Inspect git status, package.json, EvmDataClient composition, configuration,
   errors, services, HttpTransport/AxiosHttpTransport, tests, and the existing
   private Multicall3 implementation in src/providers/alchemy/AlchemyAdapter.ts.
5. Report Step 0 Context Discovery and Step 1 Architecture Design with exact
   files, dependency direction, public types, error codes, data flow, test
   plan, risks, and contradictions with the current API-only ADR.

Architecture approval gate:
- This prompt requests implementation but does not override Agent.md's approval
  gate. If the owner has not explicitly approved
  docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MULTICALL3_UPGRADE.md as the v0.4
  architecture, stop after Step 1 and ask for approval.
- After explicit approval, first update SPEC, ARCHITECTURE, INTEGRATIONS,
  DECISIONS, and NEXT_SESSION consistently. Record a new ADR that this is an
  opt-in oracle-read exception and does not replace the backend's API-only
  synchronization truth.
- Verify official Chainlink, Multicall3, Ethereum JSON-RPC, and public RPC
  behavior before source implementation. If official behavior conflicts with
  the proposal, update documentation and request approval instead of guessing.

Non-negotiable network boundary:
- Every JSON-RPC request introduced by this project is direct-only.
- Do not use ProxyPool, SingBoxProxyManager, VLESS/SS, HTTP proxies, environment
  proxies, or requestPolicy.allowDirect for health probes, block reads,
  Multicall3 eth_call, or request-time RPC retries.
- At the HTTP transport boundary explicitly disable Axios/environment proxy
  discovery. Do not read HTTP_PROXY, HTTPS_PROXY, ALL_PROXY, or NO_PROXY.
- Existing indexed REST and market API proxy behavior must remain unchanged.
- Reuse only the pure Multicall ABI codec extracted from AlchemyAdapter; never
  reuse its credential/proxy transport path for public Archive RPCs.

Product contract:
- Add opt-in chainlink configuration with built-in endpoints, caller-supplied
  endpoints, bounded health/attempt/total timeouts, max calls per Multicall,
  and max RPC attempts. A Chainlink-only client is valid.
- Client construction remains side-effect free. When Chainlink is enabled,
  client.initialize(signal) probes all configured endpoints concurrently with
  a bound: eth_chainId == 0x1, an exact historical block header exists, and
  historical Multicall3 getBlockNumber() returns the probe block.
- No background health timer. Health changes only on initialize, an explicitly
  requested refresh if implemented, and passive real-request outcomes.
- For each operation, use an injected RandomSource to build an unbiased random
  permutation of healthy endpoints. Pin all block reads and batches to one
  endpoint. On retryable endpoint/archive failure, discard partial results and
  restart from batch one on the next endpoint. Never repeat an endpoint in the
  same operation.
- Read the requested block header before and after all batches; a changed hash
  discards the operation as RPC_BLOCK_REORG_DETECTED.
- Input block number is a canonical non-negative decimal string. Convert it to
  an exact JSON-RPC quantity hex blockTag. Never use JavaScript number or
  latest.
- Expose client.chainlink.getTokenPricesAtBlock({ blockNumber, signal }). It
  always queries all enabled built-in feed definitions and has no token field.
- At least one feed success returns prices plus every feed failure. Zero
  successes throws CHAINLINK_PRICE_DATA_UNAVAILABLE.
- Result includes chainId 1, block number/hash/timestamp, registry version,
  stable rpcEndpointId (never URL), executionMode, exact decimal-string prices
  and raw answers, round metadata, heartbeat/staleness, failures, and counts.

Feed registry:
- Generate and commit one immutable Ethereum Mainnet feed manifest from the
  official Chainlink metadata source referenced by Chainlink's documentation.
- Include only standard Ethereum Mainnet Crypto/USD Reference Price feeds with
  a proxy address. Exclude SVR/shared-SVR, hidden, deprecating, non-USD,
  calculated, exchange-rate-only, market-cap, Proof of Reserve, FX, commodity,
  equity, rate, MVR, and Data Streams entries.
- Runtime must never download or auto-update the feed directory.
- Add scripts/update-chainlink-ethereum-feeds.mjs and a documented pnpm command.
  Validate unknown JSON, deterministic ordering, unique IDs/pairs/addresses,
  addresses, decimals, heartbeat, and source metadata. Record source URL,
  retrieval timestamp, and SHA-256 in generated output.
- Use the exact maintenance locations documented in
  docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md so a future AI can update
  endpoints and feeds without searching the project.

Multicall and Chainlink ABI:
- Extract the existing aggregate3 encoder/decoder from AlchemyAdapter into one
  responsibility-named pure Multicall3 codec. Refactor Alchemy to reuse the
  codec where semantically compatible; do not create a second encoder.
- Expose a public client.rpc.multicallAtBlock() module accepting validated call
  IDs, targets, calldata, allowFailure, chain 1, exact block, and signal. Return
  per-call success/returndata plus block and endpoint provenance. It must not
  understand Chainlink.
- Use canonical Ethereum Multicall3
  0xcA11bde05977b3631167028862bE2a173976CA11 and aggregate3 selector 0x82ad56cb.
- P0 must verify and record the Multicall3 Ethereum deployment block. Reject a
  lower requested block as MULTICALL_NOT_DEPLOYED_AT_BLOCK without calling the
  absent contract. Do not silently invent a pre-deployment fallback.
- For every feed, aggregate latestRoundData() selector 0xfeaf968c and decimals()
  selector 0x313ce567 with allowFailure true. Batch deterministically under the
  configured maximum and preserve feed order.
- Strictly decode (uint80,int256,uint256,uint256,uint80), including signed
  int256 two's complement. Require answer > 0, updatedAt > 0,
  startedAt <= updatedAt <= blockTimestamp, answeredInRound >= roundId, and
  decimals 0..255. A runtime/manifest decimals mismatch is a feed failure and
  maintenance signal, never a guessed price.
- Format fixed-point prices with integer/string logic only. No floating point,
  exponent notation, ethers dependency, or hidden precision loss unless a new
  dependency is first documented and approved.
- Staleness compares blockTimestamp - updatedAt to the manifest heartbeat and
  is returned as metadata; it does not replace the historical answer.

Recommended bounded work packages after approval:

P0 — Canonical documentation and verified integrations
- Add the accepted v0.4 behavior to SPEC/ARCHITECTURE/INTEGRATIONS/DECISIONS/
  NEXT_SESSION.
- Reverify the five public candidates, official terms, the Chainlink feed
  metadata source, standard-vs-SVR selection, AggregatorV3 ABI, Multicall3
  address/deployment block, and exact eth_call blockTag behavior.

P1 — Domain and configuration contract
- Add chainlink/rpc configuration, models, operation names, stable errors,
  validation, public exports, and Chainlink-only client validity.
- Tests first for decimal block normalization, endpoint uniqueness/redaction,
  strict configuration, and no constructor side effects.

P2 — Pure codecs and public Multicall contract
- Extract/test Multicall3 aggregate3 ABI code and refactor the Alchemy balance
  implementation to reuse it without changing provider behavior.
- Add strict Chainlink round-data and fixed-point codecs.
- Add the public RpcService interface using fake execution.

P3 — Direct Archive RPC execution
- Implement ArchiveRpcTransport, EthereumArchiveRpcPool,
  EthereumArchiveRpcExecutor, built-in endpoint registry, initialization
  probes, passive health, random permutation, endpoint pinning, restart from
  scratch, block-hash consistency, timeout, abort, and redaction.
- Prove in tests that a configured HTTP or managed sing-box proxy is never
  passed to these modules, including allowDirect:false configurations.

P4 — Feed generator and manifest
- Add official-source fixture, strict generator, deterministic generated
  manifest, category exclusions, core mapping assertions, update script, and
  maintenance documentation integration.

P5 — Chainlink service and client composition
- Compose all manifest calls, deterministic batches, per-feed partial failures,
  all-failure error, round validation, stale metadata, endpoint provenance,
  public client namespaces, initialize/close behavior, and package exports.

P6 — Review, documentation, packaging, and opt-in live probe
- Update README examples/status, integration caveats, next-session handoff,
  package smoke tests, tarball secret/content audit, and optional public RPC
  smoke tests that print no endpoint URL, calldata, returndata, or prices.

Required deterministic tests:
- Wrong chain, pruned archive, missing block, malformed JSON-RPC, HTTP error,
  timeout, abort, no healthy endpoint, passive cooldown, and bounded refresh.
- Random selection and no-repeat, all batches pinned to one endpoint, failure
  after a later batch causes full restart on another endpoint, and total budget.
- Direct-only behavior with explicit HTTP proxy, sing-box route,
  allowDirect:false, and environment proxy variables present in the test.
- Multicall dynamic offsets/tuples, allowFailure, empty/maximum batches,
  malformed returndata, count mismatch, and pre-deployment block.
- Chainlink negative/zero answer, int256 boundaries, invalid round/timestamps,
  decimals mismatch, exact fixed-point formatting, undeployed/reverted feed,
  stale heartbeat, partial success, all failure, and stable ordering.
- Manifest inclusion/exclusion for standard, SVR, shared-SVR, non-USD,
  calculated, exchange rate, deprecating, hidden, duplicate, and malformed
  records.
- No network in default tests, no background timer, no secret/URL/response in
  errors, telemetry, snapshots, fixtures, generated source comments, or tarball.

Verification and repository rules:
- Use apply_patch for manual file edits. Preserve user changes and do not use
  destructive git commands.
- Do not add generic utils/base/manager modules. Keep responsibility names and
  explicit dependencies.
- Do not add a dependency until official docs, selected version, purpose, and
  constraints are recorded in INTEGRATIONS and approved.
- Before each work package list files, reason, and expected impact. After each
  package run focused tests and update NEXT_SESSION.
- Run pnpm typecheck, pnpm lint, pnpm test, pnpm build, pnpm test:package, then
  pnpm check. Default tests must be network-independent.
- Perform Step 5 review for boundaries, proxy isolation, bounded loops,
  precision, redaction, extension cost, and packaging.
- Make focused conventional commits only after tests pass. Never push, rewrite
  history, invent git identity, print secrets, or claim live success without
  evidence.
```

## Usage Note

When handing this prompt to Claude Sonnet 5, also state whether the owner now
explicitly approves
`docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MULTICALL3_UPGRADE.md`. Without that
sentence, the repository's `Agent.md` correctly requires the model to stop
after architecture review instead of editing production source.

