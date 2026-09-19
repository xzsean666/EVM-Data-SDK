# Uniswap V3 Historical Price Module

Version: 0.1.0 proposal  
Status: architecture and implementation specification; source changes are not
included in this document-only milestone  
Initial chain: Ethereum Mainnet, EIP-155 chain ID `1`

## 1. Goal

Add a read-only SDK module that returns Uniswap V3 token-pair prices at one
exact historical Ethereum block. A request may contain one token or many
configured tokens. The module must use an Archive-capable JSON-RPC endpoint,
historical `eth_call` block tags, and Multicall3 so all pool reads for one
request are aggregated into a bounded number of RPC calls.

The flow is:

```text
block number
  -> Ethereum Archive RPC
  -> Multicall3 aggregate3 at the same blockTag
  -> Uniswap V3 Pool.slot0()
  -> sqrtPriceX96 + signed tick
  -> exact integer price conversion
  -> token exchange-rate result
```

This is an instantaneous pool-state price, not a candle, trade execution
price, oracle price, or a cross-provider consensus price. The implementation
also exposes a convenience method that converts the configured USD-stablecoin
and WETH quote pools into a `priceUsd` value without putting any oracle
metadata in the Uniswap registry.

## 2. Scope

### Included in v0.1

- Ethereum Mainnet only (`chainId: 1`).
- Exact non-negative decimal block numbers.
- Static, reviewed Uniswap V3 pool/token manifest; no runtime token or pool
  discovery.
- One `slot0()` call per distinct configured pool, even when several requested
  tokens share that pool.
- Multicall3 `aggregate3` batching through the existing provider-neutral
  `RpcService.multicallAtBlock()`.
- Partial success: a pool that is not deployed at the requested block, or
  whose `slot0()` call reverts/malformedly responds, is reported as a
  per-token failure while other pools can still produce prices. Endpoint-wide
  Archive failures remain operation-level errors.
- Deterministic integer arithmetic with decimal-string public quantities.
- Stable endpoint IDs only; endpoint URLs, calldata, and return data remain
  private and redacted.

### Explicitly excluded

- Other chains, L2s, or testnets.
- Runtime factory scanning, The Graph, REST pool APIs, or token metadata
  discovery.
- Automatic selection of the deepest/liquid pool, TWAP calculation from the
  observation ring, or multi-pool aggregation.
- A floating-point implementation of `1.0001 ** tick`.
- A promise that a public RPC endpoint retains arbitrary archive depth.
- Silent fallback to `latest`, a non-archive node, a proxy route, or a second
  chain.

## 3. Public API

The service is exposed as `client.uniswapV3` and is `null` unless the feature
is enabled. The exact names below are the target contract; keep them stable
once implementation starts.

### 3.1 Configuration

```ts
interface UniswapV3Configuration {
  readonly enabled?: boolean;
  /** Defaults to true when the feature is enabled. */
  readonly useBuiltinEthereumArchiveRpcs?: boolean;
  /** Appended to built-ins; IDs and normalized URLs must be unique. */
  readonly rpcEndpoints?: readonly EthereumArchiveRpcEndpointConfiguration[];
  readonly healthCheckTimeoutMs?: number;
  readonly attemptTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxCallsPerMulticall?: number;
  readonly maxRpcAttempts?: number;
}
```

`EthereumArchiveRpcEndpointConfiguration` is the existing redaction-safe
`{ id, url, enabled? }` type from `src/domain/configuration.ts`. The new
feature must reuse `ArchiveRpcTransport`, `EthereumArchiveRpcPool`,
`EthereumArchiveRpcExecutor`, and `RpcService`; it must not introduce a second
RPC client or dependency such as ethers or viem. An implementation may share
an already-created Ethereum archive pool when its configuration is identical,
but correctness and endpoint pinning take priority over pool deduplication.

Example:

```ts
const client = new EvmDataClient({
  uniswapV3: {
    enabled: true,
    useBuiltinEthereumArchiveRpcs: true,
    rpcEndpoints: [
      { id: "company-archive", url: process.env.ETH_ARCHIVE_RPC! },
    ],
  },
});

await client.initialize();

const snapshot = await client.uniswapV3!.getTokenPricesAtBlock({
  chain: "ethereum",
  blockNumber: "19000000",
  tokenIds: [
    "ethereum:uniswap-v3:weth-usdc-500",
    "ethereum:uniswap-v3:wbtc-usdc-3000",
  ],
});
```

The SDK itself never reads environment variables. The environment reference
above is application code only.

A client with only `uniswapV3.enabled: true` and a valid built-in or custom
Archive endpoint configuration is a valid feature-only client; no indexed API
provider or API key is required.

### 3.2 Request

```ts
interface UniswapV3HistoricalPriceRequest {
  readonly chain: 1 | "ethereum";
  /** Canonical non-negative base-10 integer; never a JS number. */
  readonly blockNumber: string;
  /** Null/omitted means every enabled Ethereum manifest entry. */
  readonly tokenIds?: readonly string[];
  /** Token addresses or unambiguous symbols; order-independent. Every
   * committed fee tier for the pair is returned as a separate price. */
  readonly tokenPair?: readonly [string, string];
  readonly signal?: AbortSignal;
}
```

Normalize leading zeroes (`"00042" -> "42"`), reject signs, decimals,
hexadecimal strings, empty arrays, duplicate IDs, and unknown IDs. `tokenPair`
contains two addresses or unambiguous manifest symbols, is order-independent,
and cannot be combined with `tokenIds`; all committed fee tiers for that pair
are returned separately.
A request with no selector reads the complete committed Ethereum manifest.

For the common single-token lookup, use:

```ts
const price = await client.uniswapV3!.getTokenPriceAtBlock({
  chain: "ethereum",
  token: "AAVE",
  blockNumber: "19000000",
});
// price.priceUsd
```

The token may be a configured symbol (or address). Every configured fee tier
for that token is evaluated at the same block and the highest resulting USD
price is returned. USDC and USDT quotes are treated as USD; WETH quotes are
converted through a WETH/stablecoin Uniswap V3 reference pool at that same
block.

For several tokens, use the batch method so shared pools are read once:

```ts
const result = await client.uniswapV3!.getTokenPricesAtBlockUsd({
  chain: "ethereum",
  blockNumber: "19000000",
  tokens: ["AAVE", "UNI", "USDC", "WETH"],
});
```

The method does not fetch a default set of USDC, ETH, or other prices. It
reads only pools needed by the requested tokens, de-duplicates shared pool
addresses, and sends them in one `multicallAtBlock` operation (which may be
split into configured Multicall3 batches). A WETH/stablecoin reference pool is added
to that same operation only when a requested token has a WETH quote. WETH
itself is restricted to stablecoin quote pools, so unrelated WETH/UNI or
WETH/DAI pools are not queried.

### 3.3 Result

```ts
interface UniswapV3HistoricalPriceResult {
  readonly chainId: 1;
  readonly blockNumber: string;
  readonly blockHash: string;
  readonly blockTimestamp: string;
  readonly registryVersion: string;
  /** Stable configured ID; never an endpoint URL. */
  readonly rpcEndpointId: string;
  readonly executionMode: "multicall3";
  readonly priceScale: 18;
  readonly prices: readonly UniswapV3HistoricalPrice[];
  readonly failures: readonly UniswapV3PriceFailure[];
  readonly summary: {
    readonly configuredTokens: number;
    readonly requestedTokens: number;
    readonly succeededTokens: number;
    readonly failedTokens: number;
    readonly distinctPools: number;
    readonly multicallBatches: number;
    readonly partial: boolean;
  };
}

interface UniswapV3HistoricalPrice {
  readonly tokenId: string;
  readonly tokenAddress: string;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly poolAddress: string;
  readonly feeTier: number;
  readonly token0: UniswapV3PriceAsset;
  readonly token1: UniswapV3PriceAsset;
  /** The requested token is the base; the quote is the other pool token. */
  readonly baseToken: UniswapV3PriceAsset;
  readonly quoteToken: UniswapV3PriceAsset;
  /** Raw slot0 values, preserved exactly as decimal strings. */
  readonly sqrtPriceX96: string;
  readonly tick: string;
  /** Human quote-token units per one human base-token unit. */
  readonly price: string;
  /** Price derived from the canonical tick boundary formula. */
  readonly tickPrice: string;
  /** Exact rational source for consumers that need more than 18 decimals. */
  readonly ratioNumerator: string;
  readonly ratioDenominator: string;
  readonly priceRounding: "floor";
  readonly blockNumber: string;
}

interface UniswapV3PriceAsset {
  readonly address: string;
  readonly symbol: string;
  readonly decimals: number;
}

type UniswapV3PriceFailureCode =
  | "POOL_NOT_DEPLOYED_AT_BLOCK"
  | "POOL_CALL_REVERTED"
  | "SLOT0_RESPONSE_INVALID"
  | "PRICE_CALCULATION_INVALID";

interface UniswapV3PriceFailure {
  readonly tokenId: string;
  readonly tokenAddress: string;
  readonly poolAddress: string;
  readonly code: UniswapV3PriceFailureCode;
  readonly retryable: false;
  readonly message: string;
}
```

`price` and `tickPrice` are canonical base-10 decimal strings with at most 18
fractional digits, rounded down. `ratioNumerator / ratioDenominator` is the
unrounded, direction-aware rational after token-decimal normalization. It is
the source of truth for downstream accounting. No JavaScript `number` or
floating-point operation may participate in decoding or calculation.

At least one price must succeed for a result to be returned. If every selected
token fails, reject with `UNISWAP_V3_PRICE_DATA_UNAVAILABLE`. Invalid input,
Archive RPC failure, cancellation, wrong chain, reorg, malformed Multicall3
response, and a Multicall3 deployment-boundary failure reject directly rather
than becoming token failures.

## 4. Manifest and token identity

The first implementation uses a committed allowlist in a responsibility-
named module such as `src/defi/uniswapV3TokenRegistry.ts`. It is versioned and
never fetched or mutated at runtime.

```ts
interface UniswapV3TokenDefinition {
  readonly id: string;
  readonly chainId: 1;
  readonly protocol: "uniswap-v3";
  readonly tokenAddress: string;
  readonly tokenSymbol: string;
  readonly tokenDecimals: number;
  readonly poolAddress: string;
  readonly feeTier: number;
  readonly token0: UniswapV3PriceAsset;
  readonly token1: UniswapV3PriceAsset;
  readonly quoteTokenAddress: string;
  readonly tokenDeploymentBlock?: string;
  readonly poolDeploymentBlock: string;
}
```

Manifest rules:

- `token0` and `token1` must be the pool's actual sorted addresses, lowercased
  in normalized data; their decimals must be independently verified.
- `tokenAddress` must equal exactly one of `token0.address` or `token1.address`.
- `quoteTokenAddress` must equal the other side. A token may have multiple
  entries for different fee tiers or quote pools, but each entry gets a unique
  `tokenId` and is not silently averaged.
- `poolAddress`, token addresses, fee tier, decimals, and deployment blocks
  are reviewed facts. A manifest test must reject duplicate IDs, duplicate
  `(pool, base, quote, fee)` identities, invalid addresses, invalid decimals,
  inconsistent token side, and missing deployment metadata.
- The initial registry should be deliberately small and include only pools
  whose addresses and historical deployment blocks have been checked against
  official Uniswap deployments/on-chain state. Do not fabricate a larger
  token list to make a demo look complete.

The service may accept an injected manifest in an internal constructor test
seam, but arbitrary pool definitions are not a public v0.1 input. Dynamic pool
discovery would require verifying token order, decimals, code deployment, and
quote semantics and is a separate proposal.

### 4.1 Address discovery and manifest update workflow

The SDK must never search for a pool during a price request. Address discovery
is a maintainer-time operation that produces a reviewed, committed manifest.
The implementation must add a command such as:

```text
pnpm uniswap:v3:update
```

backed by a responsibility-named script such as
`scripts/update-uniswap-v3-manifest.mjs`. The script may use a separate pure
selection module for ranking/filtering logic and a caller-supplied Archive RPC
URL for on-chain verification. It must not be imported by runtime SDK code.
Because the repository targets Node.js on Linux, macOS, and Windows, the
`.mjs` command is the canonical implementation rather than a Unix-only shell
script. A thin `scripts/update-uniswap-v3-manifest.sh` wrapper may be added for
Unix convenience, but it must only delegate to `pnpm uniswap:v3:update`; all
selection, RPC, validation, and rendering logic must remain in the tested Node
modules.

Rankings are only a candidate-discovery and prioritization input. A TVL,
volume, or token ranking can be stale, manipulated, unavailable, or ambiguous
about fee tiers; it is not an authoritative pool address and it must not decide
whether a pool is valid. The update workflow is:

```text
curated token list or ranking top-N candidates
  -> explicit token addresses (never symbol-only inference)
  -> Uniswap V3 Factory.getPool(tokenA, tokenB, fee)
  -> Archive/on-chain verification of pool and token metadata
  -> deterministic sorting and manifest rendering
  -> human review of the generated diff
  -> commit the generated manifest
```

The command should support bounded filters such as `--top`, `--quotes`,
`--fees`, and `--min-tvl`, but must always emit the same output ordering for
the same input snapshot. For every candidate it must verify, at minimum:

- canonical Factory-derived pool address and non-empty `eth_getCode`;
- `token0()`, `token1()`, and `fee()` match the candidate metadata;
- both token `decimals()` values and the explicit base/quote orientation;
- the first deployed block (or a conservatively verified deployment lower
  bound) for the pool;
- a valid `slot0()` response at a fixture block after deployment.

The generated file should be a TypeScript or JSON artifact owned by the
repository, for example
`src/defi/uniswapV3TokenRegistry.generated.ts`. It should contain a source
snapshot identifier/hash and a reviewable manifest version, but no RPC URL,
credential, raw calldata, or raw return data. Do not put a live retrieval time
into the semantic registry hash if that would make identical input produce a
different SDK result. The script must fail closed on an ambiguous symbol,
missing address, Factory mismatch, invalid decimals, missing deployment bound,
or duplicate `(pool, base, quote, fee)` identity.

The initial registry should use a small explicit quote set (for example
reviewed stablecoins and WETH) and a bounded number of top candidates. Adding
every ranking result would make the manifest slow to validate and expensive to
query. A maintainer may run the command periodically or in a protected CI job;
the SDK package receives only the reviewed generated diff.

## 5. ABI and historical RPC behavior

### 5.1 Pool call

Uniswap V3 pool `slot0()` selector is `0x3850c7bd`. Its static return tuple is:

```solidity
(uint160 sqrtPriceX96,
 int24 tick,
 uint16 observationIndex,
 uint16 observationCardinality,
 uint16 observationCardinalityNext,
 uint8 feeProtocol,
 bool unlocked)
```

For v0.1, the decoder must require exactly seven 32-byte ABI words and
validate the canonical bool word. Decode the first word as unsigned `uint160`
and the second as signed two's-complement `int24`; do not treat tick as an
unsigned integer. Valid Uniswap ticks are `[-887272, 887272]`. Reject zero or
out-of-range `sqrtPriceX96`, malformed length, non-canonical bool, or invalid
tick with `SLOT0_RESPONSE_INVALID`.

### 5.2 Multicall batching

Build one `MulticallAtBlockCall` per distinct pool:

```ts
{
  id: `uniswap-v3::${poolAddress}`,
  target: poolAddress,
  callData: "0x3850c7bd",
  allowFailure: true,
}
```

Use one `RpcService.multicallAtBlock()` call for the request. `RpcService`
performs deterministic batch splitting at its configured limit and preserves
result order. Pool results are mapped back to every selected token that points
at that pool. Never issue one RPC call per token when several tokens share a
pool.

Multicall3 on Ethereum Mainnet is the existing canonical address
`0xcA11bde05977b3631167028862bE2a173976CA11`, with the repository's verified
deployment boundary `14353601`. A request below that block must fail before
network work with `MULTICALL_NOT_DEPLOYED_AT_BLOCK`.

The existing Archive RPC executor owns endpoint selection, exact block tags,
pre/post block-hash checks, bounded retries, abort handling, and full-operation
restart. A retryable endpoint/archive/reorg failure discards every partial
pool result before trying another endpoint. A pool call revert is not an
endpoint failure.

## 6. Price mathematics

### 6.1 Canonical spot ratio from `sqrtPriceX96`

Uniswap defines:

```text
sqrtPriceX96 = sqrt(token1_raw / token0_raw) * 2^96
ratioRaw(token1/token0) = sqrtPriceX96^2 / 2^192
```

Do not square in a JavaScript number. `BigInt` can represent the required
approximately 320-bit intermediate.

For a token0 base and token1 quote, with `S = 10^18`:

```text
priceScaled =
  floor(sqrtPriceX96^2 * 10^token0Decimals * S /
        (2^192 * 10^token1Decimals))
price = renderDecimal(priceScaled, 18)
ratioNumerator   = sqrtPriceX96^2 * 10^token0Decimals
ratioDenominator = 2^192 * 10^token1Decimals
```

For a token1 base and token0 quote, invert the rational without first flooring
the forward ratio:

```text
priceScaled =
  floor(2^192 * 10^token1Decimals * S /
        (sqrtPriceX96^2 * 10^token0Decimals))
ratioNumerator   = 2^192 * 10^token1Decimals
ratioDenominator = sqrtPriceX96^2 * 10^token0Decimals
```

Reduce the rational by the greatest common divisor if that is convenient, but
preserving the exact numerator and denominator is more important than
minimizing their size. `renderDecimal` must insert the decimal point, trim
trailing fractional zeroes, and return `"0"` rather than an empty fraction.

### 6.2 Tick formula and why both values are returned

The integer tick represents the range containing the current price:

```text
ratioRawAtTick = 1.0001^tick
```

Using a language floating-point exponent is forbidden. Implement the
canonical Uniswap `TickMath.getSqrtRatioAtTick` integer algorithm (the known
Q128.128 constants and `MAX_TICK = 887272`) in a pure, fixture-tested module,
then derive `ratioRawAtTick = sqrtRatioAtTick^2 / 2^192` with the same token
decimal normalization and `S = 10^18`. This is the tick-boundary value and is
expected to differ slightly from the current intra-tick `sqrtPriceX96` price.

`price` is the canonical spot value from `sqrtPriceX96` because it preserves
intra-tick precision. `tickPrice` is returned to satisfy the tick formula
requirement and to make the state auditable. Tests must assert the expected
relationship (`tickPrice` is the tick boundary, not an exact equality claim).

### 6.3 Rounding and edge cases

- All divisions use floor/round-down and never floating point.
- A display value can be `"0"` after 18-decimal flooring for an extremely
  small ratio; this is not by itself a malformed state because the exact
  rational is returned.
- A zero denominator, zero `sqrtPriceX96`, invalid decimal metadata, or an
  arithmetic overflow guard failure is `PRICE_CALCULATION_INVALID`.
- Signed tick conversion and negative ticks must have dedicated fixtures.

## 7. Errors and failure boundaries

Add `UNISWAP_V3_PRICE_DATA_UNAVAILABLE` to `ErrorCode` and a corresponding
factory in `src/domain/errors.ts`. Reuse existing generic Archive/RPC errors
for transport and execution failures. Do not leak endpoint URLs, calldata,
return data, token credentials, or raw provider error strings.

| Condition | Behavior |
| --- | --- |
| Invalid request, duplicate/unknown token ID | Reject `INVALID_REQUEST`. |
| Feature disabled or Ethereum service missing | Reject `INVALID_CONFIGURATION` or `UNSUPPORTED_OPERATION` according to existing client conventions. |
| Block before Multicall3 deployment | Reject `MULTICALL_NOT_DEPLOYED_AT_BLOCK` before RPC. |
| Archive endpoint exhausted, wrong chain, malformed Multicall3 response, reorg | Reject the existing typed Archive/RPC error; do not return partial data. |
| Pool not deployed at requested block or empty call result | Add `POOL_NOT_DEPLOYED_AT_BLOCK` for that token. |
| `slot0()` reverted | Add `POOL_CALL_REVERTED` for that token. |
| Malformed `slot0()` ABI or invalid tick/sqrt price | Add `SLOT0_RESPONSE_INVALID`. |
| Arithmetic/manifest inconsistency | Add `PRICE_CALCULATION_INVALID`. |
| All selected tokens fail | Reject `UNISWAP_V3_PRICE_DATA_UNAVAILABLE`. |

## 8. Security and operational invariants

- Archive calls are direct-only and always pass an exact hexadecimal block tag
  derived from the caller's decimal block number. Never use `latest`.
- One operation is pinned to one endpoint. A retry starts the entire operation
  on another healthy endpoint; do not mix pool results from different block
  views.
- No background health-check timer, cache, proxy, hidden environment read, or
  runtime registry fetch.
- Stable endpoint IDs may appear in results and telemetry. URLs, API tokens,
  calldata, return data, pool balances, and raw error strings may not.
- Public on-chain integers (`blockNumber`, `sqrtPriceX96`, `tick`, ratio parts)
  are decimal strings. Token decimals and fee tier are bounded metadata
  numbers.
- Preserve existing Chainlink and `client.defi` behavior. Do not modify their
  semantics as an incidental part of this protocol module.

## 9. Acceptance criteria

The implementation is complete only when all of the following are true:

1. `client.uniswapV3` is opt-in, Ethereum-only, publicly typed, and composed
   through existing Archive RPC/Multicall3 infrastructure.
2. A single request for many tokens deduplicates shared pools and reports
   `distinctPools` and `multicallBatches` accurately.
3. Every pool read uses `slot0()` at the exact requested block; no `latest` or
   current-state fallback is possible.
4. `sqrtPriceX96`, signed negative/positive tick, token ordering, decimal
   normalization, inversion, and fixed-point rendering have deterministic
   unit fixtures.
5. Per-pool failures produce partial results with no secret or raw payload
   leakage; all-failure requests reject with the new typed error.
6. The registry is static, versioned, verified, and has tests for all metadata
   invariants and deployment boundaries.
7. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`,
   `pnpm test:package`, and `pnpm check` pass. Default tests perform no
   network I/O. Any live check is opt-in and prints only chain, endpoint ID,
   counts, and error codes.
8. `docs/INTEGRATIONS.md`, `docs/DECISIONS.md`, `docs/NEXT_SESSION.md`, and
   all documents in this directory state the same implementation status.
