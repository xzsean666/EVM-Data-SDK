# Uniswap V3 Historical Price Task Breakdown

This is the bounded execution queue for the implementation agent. Work
packages are ordered. Do not begin a later package with a failing earlier
package, and do not broaden the public scope without updating `UPGRADE.md`
and obtaining owner approval.

Status: packages are not implemented; this document is the planned queue.

## Package 0 — Context discovery and integration gate

Read `Agent.md`, `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/BUILD.md`,
`docs/INTEGRATIONS.md`, `docs/DECISIONS.md`, `docs/NEXT_SESSION.md`, and all
four documents in this directory. Inspect the current `RpcService`, Archive
pool/executor/transport, Multicall3 codec, `EvmDataClient`, configuration
normalization, public exports, and tests.

Before source changes, verify from authoritative sources and record evidence in
`docs/INTEGRATIONS.md`:

- Uniswap V3 `slot0()` selector and exact return ABI;
- canonical Ethereum Multicall3 address and deployment block;
- every initial pool address, token0/token1 ordering, fee tier, token decimals,
  and pool deployment block;
- at least two Archive-capable Ethereum endpoints with a bounded historical
  `eth_chainId`/block-header/Multicall3 check.

Decide and document the candidate source separately from the truth source:
rankings may provide a bounded Top-N candidate list, but Uniswap V3 Factory
lookups and on-chain metadata are authoritative. Do not make runtime behavior
depend on a ranking API.

Deliverable: a short Step 0/Step 1 report listing changed files, contracts,
risks, and test seams. No source or dependency edits before architecture
approval.

## Package 1 — Domain contract, configuration, and registry

Expected files (adapt only if an existing responsibility-named module is a
better owner):

- `src/domain/configuration.ts`
- `src/domain/errors.ts`
- `src/domain/uniswapV3HistoricalPriceModels.ts`
- `src/defi/UniswapV3TokenDefinition.ts`
- `src/defi/uniswapV3TokenRegistry.ts`
- `scripts/update-uniswap-v3-manifest.mjs`
- `scripts/uniswapV3ManifestSelection.mjs` (pure selection/validation seam)
- `package.json` (`uniswap:v3:update` maintainer command)
- optional `scripts/update-uniswap-v3-manifest.sh` thin wrapper; no duplicate
  shell implementation
- `src/index.ts`
- focused domain/configuration/registry tests

Implement strict Zod normalization for the Ethereum-only request, the public
request/result/failure models, the new configuration section, and a frozen,
versioned manifest. Add the maintainer-only manifest updater: ranking or
curated input is candidate discovery, while Factory `getPool()` and Archive
RPC metadata checks are authoritative. Require explicit token addresses, never
symbol-only inference. Use canonical decimal strings for block/tick/on-chain
integers. Validate token side, quote side, address casing, decimals, fee tier,
deployment metadata, unique IDs, and duplicate pool identities. Do not make
runtime SDK calls in this package; network access belongs only to the explicit
maintainer script and its injected test seam.

Acceptance: configuration remains backward compatible; an unrelated existing
client still constructs with the feature disabled; invalid unknown fields and
invalid requests fail before any RPC work. The update command can resolve a
candidate through Factory, rejects ambiguous/missing metadata, emits a stable
sorted generated manifest, and never writes secrets or raw RPC payloads.

## Package 2 — Pure slot0 ABI codec and price mathematics

Expected files:

- `src/defi/UniswapV3Slot0Codec.ts`
- `src/defi/UniswapV3PriceMath.ts`
- `tests/unit/uniswap-v3-slot0-codec.test.ts`
- `tests/unit/uniswap-v3-price-math.test.ts`

Implement and fixture-test:

- `0x3850c7bd` call data;
- exact seven-word ABI response validation;
- uint160 sqrt price decoding;
- signed int24 tick decoding, including negative values;
- canonical bool validation and tick bounds;
- `BigInt` token-decimal normalization and direction-aware inversion;
- fixed 18-decimal floor rendering;
- exact rational numerator/denominator output;
- integer `TickMath.getSqrtRatioAtTick` and negative/zero/positive tick cases.

No transport, registry, environment read, or floating-point exponent belongs in
these files. Malformed and dimensionally invalid values must fail closed.

## Package 3 — Historical price service and pool deduplication

Expected files:

- `src/defi/UniswapV3HistoricalPriceService.ts`
- `tests/unit/uniswap-v3-historical-price-service.test.ts`

Build one `MulticallAtBlockCall` per distinct pool and map each returned
`slot0()` state to every requested token using the manifest's token0/token1
orientation. Preserve request order or use an explicitly documented stable
manifest order. Report per-token failures while retaining successful pools.

Tests must cover one token, multiple tokens, shared-pool deduplication, several
pools, positive and negative ticks, token0 and token1 as base, batch counts,
pre-deployment filtering, reverted calls, malformed return data, all-failure
rejection, abort propagation, and no leakage of raw RPC payloads.

The injected port should be the existing `multicallAtBlock()` contract; do not
couple the service to an HTTP transport or endpoint pool.

## Package 4 — Client composition and Archive RPC reuse

Expected files:

- `src/client/EvmDataClient.ts`
- `src/rpc/*` only when a narrowly scoped chain/config parameter is genuinely
  required; preserve existing behavior
- `tests/unit/client.test.ts`
- configuration and Archive composition tests

Compose an opt-in `client.uniswapV3` service for Ethereum. Reuse
`ArchiveRpcTransport`, `EthereumArchiveRpcPool`, `EthereumArchiveRpcExecutor`,
and `RpcService`; do not create a second retry implementation or RPC codec.
Use the existing built-in Ethereum endpoint candidates, merge explicit
endpoints by stable ID and normalized URL, and initialize all enabled pools
through `client.initialize()`.

The feature must perform no network work in the constructor, expose `null`
when disabled, reject wrong-chain attempts, preserve direct-only behavior, and
never expose endpoint URLs. If pool sharing with Chainlink/DeFi is attempted,
prove that endpoint configuration and chain/deployment settings cannot cause
cross-feature state mixing.

## Package 5 — Full deterministic verification

Add or update tests for:

- public type exports and package smoke imports;
- config defaults, strict unknown-key rejection, timeout relationships, and
  custom endpoint redaction;
- Multicall3 deployment boundary before network work;
- exact block-tag propagation and one-endpoint operation pinning (covered by
  existing executor tests plus a service assertion);
- pool failure versus endpoint failure classification;
- registry version determinism and fixture metadata.

Run in this order and stop on the first failure:

```text
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:package
pnpm check
```

Default tests must not access the network or read credentials.

## Package 6 — Opt-in live smoke and documentation handoff

Only after deterministic checks pass, run a bounded owner-invoked smoke test
against at most two verified Archive endpoints and a small token subset. The
output may contain only chain ID, stable endpoint ID, block number, counts,
batch count, and error codes. Never print URLs, calldata, return data, raw
prices, or credentials.

Run the manifest updater separately when refreshing addresses. Review its
generated diff before committing; a ranking change alone must not silently
change the SDK registry. Record the ranking snapshot/source hash and the
on-chain verification evidence without storing RPC credentials.

Update `docs/SPEC.md`, `docs/ARCHITECTURE.md`, `docs/INTEGRATIONS.md`,
`docs/DECISIONS.md`, `docs/NEXT_SESSION.md`, README/public API documentation,
and the four module documents so status, names, and acceptance results agree.
Record any unverified pool or endpoint facts as explicit follow-up work.

## Package 7 — Future chain extension procedure

When the owner requests another chain, start from `AI_CONTEXT.md`. Verify the
new EIP-155 chain, Multicall3 address/deployment, two Archive endpoints,
Uniswap deployment/factory behavior, pool/token metadata, and historical lower
bound. Add chain-scoped types and registry fixtures first, then extend the
existing RPC parameterization rather than copying Ethereum code. Repeat the
service/client/error/fixture/live-smoke checks without changing Ethereum
semantics.
