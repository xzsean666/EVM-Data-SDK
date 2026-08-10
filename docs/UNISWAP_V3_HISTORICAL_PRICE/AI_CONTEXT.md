# AI Context Handoff — Uniswap V3 Historical Price

This document is the durable context for a future AI session. It is written so
the next model can continue the module without relying on conversation history.

Status at handoff: Ethereum-only source implementation is present; deterministic
verification passes. Live pool/address verification and reviewed manifest
refresh remain maintainer follow-up.

## 1. Repository baseline

The repository is a strict Node.js TypeScript SDK. `Agent.md` is mandatory
process guidance: read the canonical docs, separate context/design/document
work from implementation, obtain architecture approval for material changes,
use bounded work packages, and update `docs/NEXT_SESSION.md`.

Relevant existing components:

- `src/client/EvmDataClient.ts` composes nullable opt-in services and performs
  no network work in its constructor. `initialize()` initializes Archive pools.
- `src/domain/configuration.ts` owns strict Zod client configuration and the
  existing `EthereumArchiveRpcEndpointConfiguration`.
- `src/rpc/ArchiveRpcTransport.ts` performs direct-only JSON-RPC requests and
  redacts boundary errors.
- `src/rpc/EthereumArchiveRpcPool.ts` probes chain/archive capability, tracks
  passive endpoint health, and returns stable endpoint IDs.
- `src/rpc/EthereumArchiveRpcExecutor.ts` pins one operation to one endpoint,
  applies bounded retries, and guards historical consistency with block hashes.
- `src/rpc/EthereumMulticall3Codec.ts` owns pure `aggregate3` ABI encoding and
  decoding. Ethereum Multicall3 is
  `0xcA11bde05977b3631167028862bE2a173976CA11`; the repository records its
  Ethereum deployment lower bound as block `14353601`.
- `src/rpc/RpcService.ts` validates `multicallAtBlock`, chunks calls, invokes
  the executor, and returns ordered `{ id, success, returnData }` results plus
  block metadata and batch count. It currently supports chain IDs 1 and 8453;
  the Uniswap module uses only chain 1 in v0.1.
- `src/chainlink/` and `src/defi/` are existing protocol services. Preserve
  their behavior. The new protocol-specific service may live in `src/defi/`
  but should have its own public models and no hidden dependency on Chainlink.
- `src/index.ts` explicitly enumerates public exports.

Do not add a generic `utils`, `base`, or `manager` module. Name new files after
their responsibility, such as `UniswapV3Slot0Codec.ts` and
`UniswapV3PriceMath.ts`.

## 2. Chosen v0.1 product shape

Expose an independent nullable service:

```ts
client.uniswapV3.getTokenPricesAtBlock({
  chain: "ethereum",
  blockNumber: "19000000",
  tokenPair?: ["0x...baseToken", "0x...quoteToken"],
  signal?,
});
```

It is enabled by an additive `uniswapV3` configuration with the existing
Ethereum Archive endpoint shape and timeout/call-limit controls. This keeps
the protocol API discoverable while reusing the existing RPC transport,
executor, pool, and Multicall3 codec. Avoid copying the `defi` RPC logic or
creating another retry implementation. Pool sharing with another feature is
optional and must never mix chains or endpoint settings.

The first version uses a static Ethereum manifest. A token pair request matches
both pool sides without regard to order and returns every committed fee tier
for that pair as separate prices; it never averages tiers. A token ID identifies one
base token, one quote token, one pool, and one fee tier. A token can have
multiple IDs for different pools/fees; no liquidity-based runtime selection or
silent averaging occurs. Arbitrary pool definitions and runtime factory
discovery are out of scope until separately designed.

### Manifest population policy

Addresses are prepared before SDK execution. The implementation should add a
maintainer command such as `pnpm uniswap:v3:update`, backed by
`scripts/update-uniswap-v3-manifest.mjs`, which writes a generated manifest
such as `src/defi/uniswapV3TokenRegistry.generated.ts`. The command is not
called by the SDK and must not be bundled into runtime initialization.
The `.mjs` script is canonical for Linux/macOS/Windows. A Unix `.sh` file is
optional and, if present, must only delegate to the pnpm command; it must not
contain a second implementation of ranking, RPC verification, or rendering.

Use a ranking (TVL, volume, or another reviewed source) only to discover and
prioritize a bounded Top-N candidate set. Rankings are not authoritative and
must not be used directly as pool addresses, token identities, historical
truth, or runtime routing policy. Candidate token addresses must be explicit;
never infer an address from a symbol alone.

For each candidate, the updater must resolve and verify the pool through the
canonical Uniswap V3 Factory `getPool(tokenA, tokenB, fee)` and Archive RPC
checks for code, `token0()`, `token1()`, `fee()`, token decimals, deployment
lower bound, and a valid `slot0()` fixture. It then renders deterministic
ordering, duplicate checks, a source snapshot/hash, and a reviewable diff. A
missing/ambiguous address, Factory mismatch, invalid metadata, or duplicate
pool identity fails the update. The SDK receives only the reviewed generated
manifest and therefore does not pay a per-request address-discovery cost.

## 3. Public data semantics

The result contains exact block metadata, stable `rpcEndpointId`, prices,
per-token failures, distinct pool count, and Multicall batch count. Each price
contains token0/token1 metadata, base/quote orientation, `sqrtPriceX96`, signed
`tick`, a fixed 18-decimal floor-rendered `price`, a tick-boundary
`tickPrice`, and exact decimal-string `ratioNumerator`/`ratioDenominator`.

`price` means human quote-token units per one human base-token unit at the
requested block. It is an instantaneous `slot0` state, not a TWAP, candle,
oracle value, or USD assertion. `sqrtPriceX96` is the canonical spot source;
`tickPrice` is an auditable `1.0001^tick` boundary value. The two can differ
inside a tick.

All on-chain integers and block values are decimal strings. Metadata such as
token decimals and fee tier is bounded numeric data. The display price is
rounded down to 18 fractional digits; the exact rational is available for
accounting that cannot tolerate display rounding.

## 4. Required source inventory before implementation

Read these files and their focused tests before editing:

```text
Agent.md
docs/SPEC.md
docs/ARCHITECTURE.md
docs/BUILD.md
docs/INTEGRATIONS.md
docs/DECISIONS.md
docs/NEXT_SESSION.md
src/client/EvmDataClient.ts
src/domain/configuration.ts
src/domain/errors.ts
src/domain/rpcModels.ts
src/rpc/RpcService.ts
src/rpc/EthereumArchiveRpcPool.ts
src/rpc/EthereumArchiveRpcExecutor.ts
src/rpc/ArchiveRpcTransport.ts
src/rpc/EthereumMulticall3Codec.ts
src/chainlink/ChainlinkService.ts
src/defi/DeFiExchangeRateService.ts
scripts/update-uniswap-v3-manifest.mjs
scripts/uniswapV3ManifestSelection.mjs
src/index.ts
tests/unit/rpc-service.test.ts
tests/unit/ethereum-archive-rpc-pool.test.ts
tests/unit/ethereum-archive-rpc-executor.test.ts
tests/unit/client.test.ts
```

## 5. ABI and arithmetic invariants

`slot0()` is selector `0x3850c7bd` and returns exactly seven static ABI words.
Decode `sqrtPriceX96` as uint160, `tick` as signed int24, and validate the
final bool word. Valid ticks are `-887272..887272`; zero/invalid sqrt prices
are rejected.

The raw token1/token0 ratio is:

```text
sqrtPriceX96^2 / 2^192
```

For token0 as base, multiply by `10^token0Decimals / 10^token1Decimals`; for
token1 as base, invert the rational with the corresponding decimal factors.
Render with `S = 10^18` and integer floor division. Never use a JS number or
`Math.pow` for on-chain values.

For the tick formula, implement canonical integer Uniswap TickMath
(`getSqrtRatioAtTick`, Q128.128 constants, `MAX_TICK = 887272`) and derive the
tick-boundary price using the same normalization. Do not use floating-point
`1.0001 ** tick`.

## 6. Failure and security boundaries

Pool-level failures are non-retryable per-token outcomes:

```text
POOL_NOT_DEPLOYED_AT_BLOCK
POOL_CALL_REVERTED
SLOT0_RESPONSE_INVALID
PRICE_CALCULATION_INVALID
```

If all selected tokens fail, throw `UNISWAP_V3_PRICE_DATA_UNAVAILABLE`. Archive
transport exhaustion, wrong chain, reorg, malformed Multicall3 response,
caller abort, and the Multicall3 deployment lower bound remain operation-level
typed errors and must not be hidden in a partial result.

Direct-only, exact-block, one-endpoint pinning, pre/post block-hash checking,
full-operation restart, no timers, no cache, no hidden environment reads, and
no secret/raw-payload logging are hard invariants. A pool revert is never used
to mark an Archive endpoint unhealthy.

## 7. Current verification gaps

Before committing the first registry, an implementation agent must verify and
record in `docs/INTEGRATIONS.md`:

1. `slot0()` selector/ABI from the official Uniswap V3 core interface or a
   verified deployment.
2. Every initial Ethereum pool address, fee tier, token0/token1 ordering,
   token decimals, and deployment block.
3. At least two Archive endpoints that answer a bounded historical Multicall3
   call, plus their stable IDs and no secret-bearing URLs in test output.
4. A fixture block and expected slot0 return data for each initial pool or a
   pure synthetic fixture with a separately recorded live smoke.
5. The candidate ranking/source snapshot and the exact updater output are
   recorded separately from the on-chain verification evidence.

Do not present unverified addresses as production facts. A small verified
manifest is preferable to an impressive but fabricated inventory.

## 8. Chain extension procedure

When adding another chain, do not simply add a string to a union or copy the
Ethereum registry. Follow this sequence:

1. Confirm the EIP-155 chain ID and canonical chain alias. Add a chain-scoped
   configuration and service route only after checking existing chain modeling.
2. Verify the canonical Multicall3 address and the first block where its code
   exists on that chain. Add a chain-specific deployment boundary; requests
   before it must fail without RPC work.
3. Verify at least two Archive-capable endpoints with `eth_chainId`, an exact
   historical block header, and a historical Multicall3 call. Add stable IDs
   to a responsibility-named built-in registry only after bounded evidence.
4. Reuse `ArchiveRpcTransport`, `EthereumArchiveRpcPool`,
   `EthereumArchiveRpcExecutor`, and `RpcService` with explicit chain ID,
   Multicall3 address, and deployment metadata. Never let a Base/Arbitrum/etc.
   endpoint pass an Ethereum health probe.
5. Verify the chain's Uniswap V3 factory/deployment, every pool's address,
   token0/token1 ordering, fee tier, decimals, and deployment block. Add a
   chain-scoped manifest and deterministic metadata tests.
6. Add synthetic slot0/math fixtures, service deduplication tests, config and
   client composition tests, then rerun the complete offline suite.
7. Run a small opt-in live smoke against two endpoints. Report only chain,
   endpoint ID, block, counts, batch count, and error codes. Update
   `UPGRADE.md`, `TASK_BREAKDOWN.md`, `AI_CONTEXT.md`, `SPEC.md`,
   `ARCHITECTURE.md`, `INTEGRATIONS.md`, `DECISIONS.md`, and
   `NEXT_SESSION.md` in the same milestone.

The price mathematics is chain-independent; address/manifest, RPC health,
Multicall deployment, and operational limits are chain-specific. Keep those
responsibilities separate so adding a chain cannot change Ethereum results.

## 9. Next AI session checklist

- Read the required source inventory and all canonical docs.
- Confirm whether the owner approved the architecture; if not, report Step 0
  and Step 1 only.
- Verify external Uniswap and Archive facts before adding registry entries.
- Use the updater to generate candidates, but treat Factory/on-chain checks as
  the only acceptance authority; review the generated diff before committing.
- Implement packages in `TASK_BREAKDOWN.md` order with focused fixtures.
- Keep this handoff status and `docs/NEXT_SESSION.md` current after each
  package.
