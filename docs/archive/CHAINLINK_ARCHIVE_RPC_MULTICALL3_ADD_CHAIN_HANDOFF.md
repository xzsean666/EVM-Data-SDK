# Handoff: Adding Another Chain to Chainlink Historical Prices via Archive RPC and Multicall3

Project ID: `chainlink-ethereum-archive-rpc-multicall3`

Status: Reference document for a **future** upgrade. Nothing in this file has
been implemented yet. The feature described below currently supports
**Ethereum Mainnet only**.

Last updated: 2026-08-07

## 1. Purpose

The v0.4 feature (`client.chainlink.getTokenPricesAtBlock()`,
`client.rpc.multicallAtBlock()`) is implemented for Ethereum Mainnet only,
end to end: configuration, feed manifest, built-in RPC registry, and every
hardcoded `chainId: 1`. This document is a self-contained context package for
a future AI session asked to extend the feature to one or more additional
EVM chains (for example Base, chain ID 8453). Give the future AI this file
plus the standard `Agent.md` workflow; it should not need to rediscover the
existing design from source alone.

This document does **not** pre-decide the multi-chain architecture (a single
parametrized service vs. one service instance per chain vs. some other
shape). That decision belongs to `Agent.md`'s Step 1 Architecture Design and
the owner approval gate, informed by section 4 below.

## 2. How to Use This Document

Read this file completely, then follow `Agent.md`'s workflow exactly as the
original implementation did:

1. Step 0 Context Discovery: read this file, then
   `docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MULTICALL3_UPGRADE.md` (the accepted
   Ethereum-only architecture this extends),
   `docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md`, and the current
   `docs/SPEC.md` / `docs/ARCHITECTURE.md` / `docs/INTEGRATIONS.md` /
   `docs/DECISIONS.md` sections referenced in section 6 below. Then read the
   actual source files listed in section 5 — this document summarizes them,
   it does not replace reading them.
2. Step 1 Architecture Design: propose the exact shape of the multi-chain
   extension (see section 4's open questions) and stop for explicit owner
   approval before touching source, exactly as the original v0.4 proposal
   did.
3. After approval: update `SPEC.md`/`ARCHITECTURE.md`/`INTEGRATIONS.md`/
   `DECISIONS.md`/`NEXT_SESSION.md` first, verify every new-chain fact in
   section 6 against official sources, then implement in bounded work
   packages with tests first, following the same discipline as the original
   P0-P6 packages recorded in `docs/NEXT_SESSION.md`.

A ready-to-paste prompt template is in section 8.

## 3. Current Implementation, Summarized

`client.chainlink.getTokenPricesAtBlock({ blockNumber, signal })` accepts one
canonical decimal Ethereum Mainnet block number and returns every configured
feed's exact `latestRoundData()` as of that block, batched in one or more
Multicall3 `aggregate3` calls. `client.rpc.multicallAtBlock({ chain: 1,
blockNumber, calls, signal })` is the underlying chain-agnostic-in-principle
Multicall3 primitive, exposed publicly and independent of Chainlink. Both are
opt-in via `chainlink: { enabled: true }`; a Chainlink-only client (no
`providers`) is valid.

Data flow:

```text
chainlink.getTokenPricesAtBlock()
       |
       v
ChainlinkService --------------------> ethereumMainnetPriceFeeds.generated.ts
       |
       v
RpcService.multicallAtBlock()  <---- public, Chainlink-agnostic
       |
       v
EthereumArchiveRpcExecutor  (endpoint pin, restart-on-failure, block reorg check)
       |
       v
EthereumArchiveRpcPool      (initialize() probes, passive health, random permutation)
       |
       v
ArchiveRpcTransport  ---- direct-only, proxy: null, never ProxyPool/sing-box
       |
       v
builtinEthereumArchiveRpcs.ts + caller-supplied chainlink.rpcEndpoints
```

Every JSON-RPC request this feature makes is direct HTTPS only. It never
uses `ProxyPool`, `SingBoxProxyManager`, `requestPolicy.allowDirect`, or
`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY` — `ArchiveRpcTransport`
always passes `proxy: null` and has no proxy parameter on its call options at
all. This is a structural, non-negotiable invariant (ADR-028/ADR-029) that
must hold for any additional chain too.

Each configured Archive RPC endpoint (built-in or caller-supplied) is probed
during `client.initialize()`; health is passive afterward (updated only by
real request outcomes), with no background timer. Each operation randomly
permutes currently-healthy endpoints (via an injected `RandomSource`), pins
the whole operation to one endpoint, and restarts from scratch on another
endpoint after a retryable failure — it never resumes mid-operation on a new
endpoint. A pre/post block-hash check around the batches guards against a
reorg during execution.

Every feed evaluates independently: a single reverted/undeployed/malformed
feed becomes a `ChainlinkFeedFailure` without failing the whole call;
`result.summary.partial` flags any per-feed failure; zero successes throws
`CHAINLINK_PRICE_DATA_UNAVAILABLE`. Prices are exact base-10 fixed-point
strings computed from integer arithmetic only — no floating point, no
`ethers`/`viem` dependency.

## 4. Chain-Agnostic vs. Ethereum-Specific: What Actually Needs to Change

This is the most important section for scoping the work. Most of the
low-level mechanics are already chain-agnostic; almost everything
Ethereum-specific lives in naming, the feed manifest, and the built-in
endpoint registry — not in the ABI/HTTP/retry logic itself.

| Module | Chain-specific today? | Why |
| --- | --- | --- |
| `src/rpc/ArchiveRpcTransport.ts` | No | Pure JSON-RPC 2.0 HTTP mechanics; has no chain, address, or ABI knowledge at all. |
| `src/rpc/RandomSource.ts` (`shuffle`) | No | Generic Fisher-Yates over an injected `RandomSource`; no domain knowledge. |
| `src/rpc/EthereumMulticall3Codec.ts` | Mostly no | `encodeAggregate3`/`decodeAggregate3Result` are pure ABI mechanics for the `aggregate3((address,bool,bytes)[])` selector, identical on every chain. Only `MULTICALL3_ADDRESS` (same on 250+ chains including, very likely, Base — verify per chain, some chains deploy at a different address or not at all) and `MULTICALL3_ETHEREUM_MAINNET_DEPLOYMENT_BLOCK` (chain-specific: each chain has its own deployment block/tx) are chain-specific. The file and constant names bake in "Ethereum Mainnet"; a per-chain deployment block table (or a lookup keyed by chain) is needed. |
| `src/chainlink/ChainlinkRoundDataCodec.ts` | No | `AggregatorV3Interface.decimals()`/`latestRoundData()` ABI mechanics and `formatFixedPointPrice()` are identical on every EVM chain; Chainlink uses the same interface everywhere. |
| `src/rpc/EthereumArchiveRpcExecutor.ts` | No (mostly) | Endpoint pinning, total/attempt timeout budget, restart-on-retryable-failure, and block-hash reorg check take an already-encoded Multicall3 address/call data and a block number; nothing here is Ethereum-specific. It is named `Ethereum...` but has no Ethereum-specific logic inside it. |
| `src/rpc/EthereumArchiveRpcPool.ts` | Yes, one spot | `probeEndpoint()` hardcodes `chainId !== "0x1"` as a health-probe rejection. This must become a configured/parametrized expected chain ID (e.g. `0x2105` for Base) per pool instance. Everything else (probe block, Multicall3 `getBlockNumber()` check, random snapshot) is otherwise chain-agnostic given the right inputs. |
| `src/rpc/builtinEthereumArchiveRpcs.ts` | Yes, entirely | This is the Ethereum-only built-in public endpoint registry. A new chain needs its own separately-verified registry (its own maintenance doc, its own probe script target) — Ethereum's public endpoints are not assumed to also serve another chain. |
| `src/rpc/RpcService.ts` | Yes, one spot | Hardcodes the `MULTICALL3_ETHEREUM_MAINNET_DEPLOYMENT_BLOCK` pre-deployment rejection. Needs a per-chain deployment block source. The rest (batching, chunking, call ID mapping) is chain-agnostic; it already threads a `chain` field through `MulticallAtBlockRequest`/`MulticallAtBlockResult` in `src/domain/rpcModels.ts`, but today it is only ever `1`. |
| `src/chainlink/ChainlinkFeedDefinition.ts` | Yes, by type | `readonly chainId: 1;` is a literal type, not a general `number`. Extending this to a union (`1 \| 8453`) or a generic `number` is a source-breaking type change for every consumer of this interface — decide deliberately at Step 1 whether to keep per-chain literal unions (safer, matches this project's "exact contracts, no loose typing" convention) or widen to `number`. |
| `src/chainlink/ethereumMainnetPriceFeeds.generated.ts` | Yes, entirely | The whole file is a generated, Ethereum-only manifest. A new chain needs its own generated manifest file (e.g. `basePriceFeeds.generated.ts`) from its own official metadata source — never merge chains into one array casually; feed addresses, decimals, and heartbeats are all chain-specific and independently verified. |
| `src/chainlink/ChainlinkService.ts` | Yes, a few spots | Imports `ETHEREUM_MAINNET_CHAINLINK_PRICE_FEEDS` directly and hardcodes `chainId: 1` in the result. Needs to accept/select a feed manifest and expected chain ID rather than importing one fixed manifest. |
| `src/domain/chainlinkModels.ts` | Yes | `ChainlinkTokenPricesAtBlockRequest`/`Result` hardcode `chainId: 1`. Needs either a `chain` selector on the request, or (if going the "one client, one chain" route) stays implicit but sourced from configuration instead of a literal. |
| `src/domain/configuration.ts` (`ChainlinkConfiguration`) | Yes | Has no chain selector at all today — it is implicitly Ethereum Mainnet. Needs an explicit way to pick a chain (or chains) once this is multi-chain, plus per-chain `rpcEndpoints`/`useBuiltinArchiveRpcs` (a Base custom RPC endpoint must never be silently probed as if it were an Ethereum endpoint). |
| `scripts/update-chainlink-ethereum-feeds.mjs` + `scripts/chainlinkFeedSelection.mjs` | Yes | Fetches `feeds-mainnet.json` specifically and applies Ethereum-Mainnet-shaped selection assumptions (though the selection *predicate* — `productTypeCode == "RefPrice"`, USD quote, Crypto asset class, no SVR proxy, not hidden, no shutdown date — is very likely chain-independent in the underlying Chainlink metadata format; verify this, don't assume it). A new chain needs its own generator invocation against its own source file/URL, ideally reusing the same pure selection logic in `chainlinkFeedSelection.mjs` parametrized by source URL and output path rather than duplicating it. |
| `scripts/probe-ethereum-archive-rpcs.mjs` | Yes | Hardcodes the Ethereum probe block (`18,000,000` / `0x112a880`), chain ID (`0x1`), and the ETH/USD Chainlink proxy address used as the feed-decode check. A new chain's probe script needs its own probe block (not earlier than that chain's own verified Multicall3 deployment block), its own expected chain ID, and its own reference feed address for the decode check. |
| `docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md` | Yes, entirely | This document's registry/probe/acceptance-checklist procedure is written specifically for Ethereum Mainnet endpoints and the Ethereum feed manifest. A new chain needs its own maintenance document (or this one needs restructuring into a per-chain section layout) so a future maintainer always knows exactly which file governs which chain's endpoints. |

**Net takeaway:** the HTTP transport, retry/pinning/reorg-guard executor,
Multicall3 ABI codec, and Chainlink round-data codec are already reusable
as-is or with trivial parametrization. The real work is (a) making the
handful of hardcoded `chainId`/deployment-block/manifest-import spots
data-driven per chain, and (b) doing the same from-scratch verification work
for the new chain that P0 did for Ethereum: deployment block, feed metadata
source, official public RPC candidates, and a reference feed address for
probe validation. Do not skip that verification just because the code
pattern already exists — a wrong deployment block or a wrong feed address
for the new chain is a silent-wrong-data bug, not a compile error.

## 5. Exact File Inventory (Current, Ethereum-Only)

```text
src/rpc/
  ArchiveRpcTransport.ts              direct JSON-RPC HTTP, proxy: null always
  RandomSource.ts                     shuffle() over injected RandomSource
  EthereumMulticall3Codec.ts          aggregate3 ABI encode/decode, MULTICALL3_ADDRESS,
                                       MULTICALL3_ETHEREUM_MAINNET_DEPLOYMENT_BLOCK
  EthereumArchiveRpcPool.ts           initialize() probes, passive health, random snapshot
  EthereumArchiveRpcExecutor.ts       endpoint pin, restart-on-failure, reorg guard
  RpcService.ts                       public multicallAtBlock(), pre-deployment rejection
  builtinEthereumArchiveRpcs.ts       Ethereum-only built-in endpoint registry

src/chainlink/
  ChainlinkRoundDataCodec.ts          AggregatorV3Interface ABI, formatFixedPointPrice()
  ChainlinkFeedDefinition.ts          feed entry shape (chainId: 1 literal)
  ethereumMainnetPriceFeeds.generated.ts   generated Ethereum feed manifest
  ChainlinkService.ts                 getTokenPricesAtBlock(), imports the manifest above

src/domain/
  rpcModels.ts                        MulticallAtBlockRequest/Result contracts
  chainlinkModels.ts                  ChainlinkTokenPricesAtBlockRequest/Result contracts
  configuration.ts                    ChainlinkConfiguration / chainlinkSchema
  errors.ts                           archiveRpcUnavailable, rpcBlockReorgDetected,
                                       multicallNotDeployedAtBlock, chainlinkPriceDataUnavailable, etc.

src/client/EvmDataClient.ts            wires client.rpc / client.chainlink, initialize()
src/index.ts                           public exports

scripts/
  update-chainlink-ethereum-feeds.mjs  maintainer command: regenerate the feed manifest
  chainlinkFeedSelection.mjs           pure, testable selection/render logic (network-free)
  probe-ethereum-archive-rpcs.mjs      maintainer command: pnpm probe:ethereum-archive-rpcs

tests/unit/
  chainlink-service.test.ts
  archive-rpc-transport.test.ts
  builtin-ethereum-archive-rpcs.test.ts
  chainlink-domain.test.ts
  chainlink-feed-selection.test.ts
  chainlink-round-data-codec.test.ts
  ethereum-archive-rpc-executor.test.ts
  ethereum-archive-rpc-pool.test.ts
  multicall3-codec.test.ts
  random-source.test.ts
  rpc-service.test.ts
  client.test.ts                       (chainlink/Archive RPC composition tests within)
tests/fixtures/chainlinkFeedMetadata.ts

docs/
  CHAINLINK_ETHEREUM_ARCHIVE_RPC_MULTICALL3_UPGRADE.md   accepted architecture (Ethereum-only)
  CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md          endpoint/feed maintenance (Ethereum-only)
  CLAUDE_SONNET_5_CHAINLINK_ETHEREUM_ARCHIVE_RPC_MULTICALL3_IMPLEMENTATION_PROMPT.md  original build prompt
```

`docs/SPEC.md` section 13, `docs/ARCHITECTURE.md` section 20a, and
`docs/DECISIONS.md` ADR-028/ADR-029 record the accepted Ethereum-only design
and its non-negotiable invariants; `docs/INTEGRATIONS.md` sections 15-17
record the verified Multicall3/Chainlink/RPC facts for Ethereum specifically.

## 6. Facts to Re-Verify for the New Chain Before Writing Any Code

Do not assume any of the following transfer from Ethereum. Verify each one
independently for the target chain, the same way P0 did for Ethereum
(recorded in `docs/INTEGRATIONS.md` sections 15-17 and
`docs/NEXT_SESSION.md`), and record the new evidence the same way:

1. **Multicall3 deployment address and block.** `0xcA11bde0...` is deployed
   on 250+ chains at the same address per the public `multicall3.com`
   registry/`mds1/multicall3` GitHub repo, but confirm the target chain is
   actually on that list, and separately confirm its **deployment block on
   that chain** (this is chain-specific even when the address is identical)
   via that chain's own block explorer API and the contract's creation
   transaction — exactly as `INTEGRATIONS.md` section 15 did for Ethereum.
2. **Chainlink feed metadata source for the target chain.** The existing
   generator fetches `https://reference-data-directory.vercel.app/feeds-mainnet.json`
   for Ethereum. Chainlink publishes per-chain metadata files from the same
   reference-data-directory project (Base feeds are listed at
   `data.chain.link/feeds/base/...`, confirming Base has its own feed set) —
   find and confirm the exact source file/URL for the target chain from
   Chainlink's own documentation/GitHub, do not guess a filename.
3. **Selection predicate portability.** Confirm whether the exact v0.4
   selection rule (`productTypeCode == "RefPrice"`, `docs.quoteAsset ==
   "USD"`, `docs.assetClass == "Crypto"`, no `secondaryProxyAddress`, not
   `docs.hidden`, no `docs.shutdownDate`) still correctly identifies standard
   Crypto/USD feeds in the new chain's metadata shape, or whether that
   chain's file has additional product types/fields that need a rule
   adjustment. Chainlink's feed metadata schema is shared infrastructure
   across chains, so this is likely portable, but verify against the actual
   fetched file rather than assuming.
4. **A reference feed address for RPC-probe validation.** Ethereum's probe
   uses the ETH/USD proxy (`0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`) as a
   `latestRoundData()` decode check. Pick and confirm the equivalent
   canonical reference feed for the new chain (its native-asset/USD feed is
   the natural choice, e.g. ETH/USD on Base) from Chainlink's own address
   page for that chain.
5. **Official public unauthenticated Archive RPC candidates for the new
   chain.** Ethereum's candidate set in
   `docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md` sections 2-3 is
   Ethereum-specific; a public RPC that serves Ethereum does not necessarily
   serve the new chain, and vice versa. Discover and probe fresh candidates
   for the new chain using the same acceptance checklist (official docs
   published, anonymous use permitted by current terms, HTTPS, no
   credentials in the URL, historical `eth_call` supported, at least two
   healthy built-ins). Do not copy the Ethereum list.
6. **`eth_chainId` value for the new chain.** For example Base Mainnet is
   `0x2105` (8453 decimal) — confirm against the chain's own documentation
   rather than this note.

## 7. Non-Negotiable Invariants That Must Carry Over Unchanged

These are not chain-specific and must hold identically for every chain this
feature ever supports:

- Direct-only JSON-RPC: never `ProxyPool`, `SingBoxProxyManager`,
  `requestPolicy.allowDirect`, or environment proxy variables for any
  Archive RPC traffic, on any chain. `ArchiveRpcTransport` must keep having
  no proxy parameter at all.
- No background health timers; health changes only via an explicit
  `initialize()`/refresh call or a passive real-request outcome report.
- Per-operation endpoint pinning with a full restart (not a resume) on
  another endpoint after a retryable failure; never repeat an endpoint
  within one operation.
- Pre/post block-hash consistency check around every batch sequence; discard
  and fail as a reorg-detected error on mismatch.
- Canonical non-negative base-10 decimal block numbers only; convert to an
  exact hex `blockTag` at the RPC boundary; never use `latest` or a floating
  point number for a historical read.
- Exact integer/string fixed-point price formatting; no floating point, no
  new ABI dependency without recording it in `INTEGRATIONS.md` first.
- Per-feed independent success/failure with `summary.partial`; only reject
  the whole call when every feed fails.
- Never a stable endpoint ID leaks a URL; never a URL, calldata, returndata,
  header, or price appears in a log, error, telemetry payload, generated
  source comment, snapshot, fixture, or tarball.
- The project's existing "no generic utils/manager/base module" and "no
  duplicate abstraction for an existing concept" rules: reuse
  `ArchiveRpcTransport`/`EthereumArchiveRpcExecutor`/the ABI codecs across
  chains through parametrization, do not fork them per chain unless Step 1
  concludes parametrization is genuinely unworkable and the owner approves
  the duplication with a stated reason.
- `Agent.md`'s full workflow: Step 0 discovery, Step 1 design with an
  explicit owner approval gate before any source change, documentation
  updated before implementation, tests first, `pnpm check` green, focused
  conventional commits only, never push, never fabricate a git identity.

## 8. Ready-to-Paste Handoff Prompt

```text
You are the implementation engineer for the EVM-Data-SDK repository at
/home/sean/git/EVM-Data-SDK.

Project: extend the existing Ethereum-only Chainlink Historical Prices via
Archive RPC and Multicall3 feature to support <TARGET_CHAIN> (chain ID
<TARGET_CHAIN_ID>).

Mandatory first action:
1. Read Agent.md completely.
2. Read docs/CHAINLINK_ARCHIVE_RPC_MULTICALL3_ADD_CHAIN_HANDOFF.md completely
   — it summarizes the existing Ethereum-only implementation, exactly which
   modules are chain-agnostic vs. Ethereum-specific, and exactly which facts
   must be re-verified for the new chain before any source change.
3. Read docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MULTICALL3_UPGRADE.md,
   docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md, docs/SPEC.md section
   13, docs/ARCHITECTURE.md section 20a, and docs/DECISIONS.md ADR-028/
   ADR-029 completely.
4. Read every source file listed in the handoff document's file inventory
   (section 5), not just this summary.
5. Report Step 0 Context Discovery and Step 1 Architecture Design: propose
   the exact multi-chain shape (parametrized single service vs. per-chain
   instances vs. another approach), the exact configuration surface change,
   whether ChainlinkFeedDefinition.chainId stays a literal union or widens,
   and the exact new/changed files. Stop here for explicit owner approval —
   do not touch source before it is given.

After approval:
- Verify every fact in the handoff document's section 6 (Multicall3
  deployment block on <TARGET_CHAIN>, the official Chainlink feed metadata
  source for <TARGET_CHAIN>, selection-predicate portability, a reference
  feed address for probe validation, official public Archive RPC candidates
  for <TARGET_CHAIN>, and its eth_chainId) against official sources before
  writing implementation code. Record the evidence in INTEGRATIONS.md the
  same way the original P0 work package did for Ethereum.
- Update SPEC/ARCHITECTURE/INTEGRATIONS/DECISIONS/NEXT_SESSION first.
- Preserve every non-negotiable invariant in the handoff document's section
  7 unchanged: direct-only RPC, no background timers, endpoint pinning with
  full restart, reorg guard, exact fixed-point arithmetic, per-feed partial
  failure, and full redaction of URLs/calldata/returndata/prices everywhere.
- Add/extend tests first, mirroring the existing Ethereum test files listed
  in the handoff document's section 5.
- Run pnpm typecheck, pnpm lint, pnpm test, pnpm build, pnpm test:package,
  then pnpm check. Update docs/NEXT_SESSION.md after each bounded work
  package.
- Make focused conventional commits only after tests pass. Never push,
  rewrite history, invent a git identity, print secrets, or claim live
  success without evidence.
```

Fill in `<TARGET_CHAIN>` and `<TARGET_CHAIN_ID>` (and state explicit owner
approval of the resulting Step 1 proposal) when handing this to a future AI
session.
