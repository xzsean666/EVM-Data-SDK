# Ready-to-Paste Implementation Prompt

Copy the following prompt to Claude Sonnet 5 or ChatGPT Terra together with
access to the repository.

```text
You are the implementation engineer for /home/sean/git/EVM-Data-SDK.

Task: implement the Uniswap V3 Historical Price module specified by
docs/UNISWAP_V3_HISTORICAL_PRICE/UPGRADE.md. The first release supports
Ethereum Mainnet only (EIP-155 chain ID 1) and reads historical token-pair
prices at an exact block. It must support one request containing many
configured tokens and must deduplicate tokens that use the same Uniswap V3
pool.

Before editing source, read completely:
  Agent.md
  docs/SPEC.md
  docs/ARCHITECTURE.md
  docs/BUILD.md
  docs/INTEGRATIONS.md
  docs/DECISIONS.md
  docs/NEXT_SESSION.md
  docs/UNISWAP_V3_HISTORICAL_PRICE/UPGRADE.md
  docs/UNISWAP_V3_HISTORICAL_PRICE/TASK_BREAKDOWN.md
  docs/UNISWAP_V3_HISTORICAL_PRICE/AI_CONTEXT.md

Inspect the existing EvmDataClient, configuration normalization, public index,
RpcService, EthereumArchiveRpcPool, EthereumArchiveRpcExecutor,
ArchiveRpcTransport, EthereumMulticall3Codec, ChainlinkService,
DeFiExchangeRateService, and their unit tests. First report Step 0 Context
Discovery and Step 1 Architecture Design: existing modules, exact files to
change, public types, data flow, external facts that still need verification,
risks, and test seams. Do not edit src/ or install dependencies until the
owner approves the architecture, as required by Agent.md.

After approval, execute TASK_BREAKDOWN.md in order. Keep each package bounded,
run its focused tests, and update docs/NEXT_SESSION.md after each package.
Use apply_patch for edits. Do not reset or revert user changes, rewrite git
history, push, or invent git identity.

Public target:
  client.uniswapV3: UniswapV3HistoricalPriceService | null
  client.uniswapV3.getTokenPricesAtBlock({
    chain: "ethereum" | 1,
    blockNumber: canonical decimal string,
    tokenIds?: string[],
    signal?: AbortSignal,
  })

Add an opt-in uniswapV3 configuration using the existing redaction-safe
EthereumArchiveRpcEndpointConfiguration and existing Ethereum Archive RPC
candidate list. Reuse ArchiveRpcTransport, EthereumArchiveRpcPool,
EthereumArchiveRpcExecutor, RpcService, and EthereumMulticall3Codec. Do not
add ethers, viem, another HTTP client, another retry loop, a cache, a proxy,
runtime registry discovery, or a background health timer. The constructor must
not make network requests. initialize() must initialize enabled RPC pools.

Non-negotiable RPC behavior:
  - Convert the caller's decimal block number to an exact hex blockTag.
  - Every eth_call must use that blockTag; never use latest.
  - One operation is pinned to one endpoint and guarded by the existing
    pre/post block-hash checks.
  - A retryable endpoint/archive/reorg failure discards all partial pool
    results and restarts the whole operation on another healthy endpoint.
  - A pool contract revert is a per-token failure, not an endpoint failure.
  - Keep direct-only RPC behavior and all existing Chainlink/DeFi semantics.
  - Only stable endpoint IDs may be public. Never expose URLs, credentials,
    calldata, return data, or raw upstream error text.

Manifest:
  - Create a small, frozen, versioned Ethereum Uniswap V3 token manifest in a
    responsibility-named src/defi file.
  - Add a maintainer-only updater such as
    scripts/update-uniswap-v3-manifest.mjs and a package command
    `pnpm uniswap:v3:update`. The SDK must never call this script or perform
    runtime pool discovery.
  - Use the Node `.mjs` script as the canonical cross-platform implementation.
    An optional Unix `.sh` file may be a one-line/short wrapper that delegates
    to pnpm, but never duplicate the updater logic in shell.
  - A ranking source (TVL, volume, or another reviewed leaderboard) may be
    used only to discover/prioritize a bounded Top-N candidate set. It is not
    authoritative, must not be used as a pool address, and must not determine
    runtime routing. Candidate token addresses must be explicit; never infer
    an address from a symbol alone.
  - For each candidate, resolve the address through the canonical Uniswap V3
    Factory `getPool(tokenA, tokenB, fee)` and verify code, token0/token1,
    fee, decimals, deployment lower bound, and a valid slot0 fixture via
    Archive RPC. Render deterministic ordering and a source snapshot/hash;
    fail closed on ambiguity, mismatch, missing metadata, or duplicate pool
    identity. Review the generated diff before committing it.
  - Each entry must record tokenAddress, token0/token1 address+symbol+decimals,
    poolAddress, feeTier, quoteTokenAddress, and poolDeploymentBlock.
  - tokenAddress must be exactly token0 or token1; quoteTokenAddress must be
    the other side. Multiple fee tiers are separate IDs and are never silently
    averaged.
  - Verify all initial addresses, token ordering, decimals, fee tiers, and
    deployment blocks from authoritative/on-chain evidence before committing
    them. Do not fabricate a large registry. Runtime discovery is out of scope.
  - Add deterministic tests for manifest uniqueness, address/decimal validity,
    token-side consistency, version determinism, updater filtering, Factory
    resolution, ranking-as-candidate-only behavior, and secret redaction.

Pool ABI:
  - slot0() selector is 0x3850c7bd.
  - Require exactly seven 32-byte ABI words in the return data.
  - Decode sqrtPriceX96 as uint160 and tick as signed two's-complement int24.
  - Validate tick in [-887272, 887272], sqrtPriceX96 > 0, and canonical bool
    encoding in the seventh word. Reject malformed data fail-closed.
  - Create one MulticallAtBlockCall per distinct pool with id
    uniswap-v3::<lowercase pool address>, target=pool address,
    callData=0x3850c7bd, allowFailure=true. Map the result to every selected
    token using the manifest orientation.

Price mathematics:
  - Never use JavaScript number or floating point for on-chain arithmetic.
  - For token1/token0 raw ratio use
      sqrtPriceX96^2 / 2^192.
  - Apply token decimals and direction using BigInt rational arithmetic. For
    one human base token, return human quote units. Use a fixed display scale
    of 18 decimal places and floor/round down. Also return exact rational
    numerator and denominator as decimal strings.
  - Implement canonical Uniswap TickMath.getSqrtRatioAtTick with integer
    constants (MAX_TICK=887272) in a pure module. Derive tickPrice using the
    tick boundary ratio 1.0001^tick with the same decimal normalization.
  - price is the precise intra-tick sqrtPriceX96 spot value; tickPrice is the
    auditable tick-boundary value. Do not assert they are always equal.
  - Return sqrtPriceX96 and signed tick as decimal strings.

Failure contract:
  - Add UNISWAP_V3_PRICE_DATA_UNAVAILABLE to ErrorCode.
  - Per-token failures use POOL_NOT_DEPLOYED_AT_BLOCK,
    POOL_CALL_REVERTED, SLOT0_RESPONSE_INVALID, or
    PRICE_CALCULATION_INVALID, all retryable=false.
  - If all selected tokens fail, reject with the new typed unavailable error.
  - Invalid request, disabled service, wrong chain, Multicall3 deployment
    boundary, archive exhaustion, malformed Multicall3 response, reorg, and
    abort must use existing typed boundaries and must not be converted into a
    partial result.

Testing:
  - Default tests are offline and use fake transports/executors.
  - Cover config defaults and strict validation, public exports, request
    normalization, slot0 ABI fixtures, signed negative/positive ticks,
    TickMath, token0/token1 inversion, decimal scaling, shared-pool
    deduplication, batching, partial/all failures, pre-deployment filtering,
    exact block tags, endpoint pinning/restart, abort, and secret redaction.
  - Run pnpm typecheck, pnpm lint, pnpm test, pnpm build,
    pnpm test:package, and pnpm check. Do not run network tests by default.
  - A live smoke is opt-in only, bounded to two endpoints and a small token
    subset; output only chain, stable endpoint ID, counts, batch count, and
    error codes. Never print URLs, calldata, return data, raw prices, or keys.
  - Address refresh is a separate maintainer workflow. A leaderboard change
    alone must not silently change the committed SDK registry.

Documentation:
  - Keep UPGRADE.md, TASK_BREAKDOWN.md, AI_CONTEXT.md,
    docs/INTEGRATIONS.md, docs/DECISIONS.md, docs/ARCHITECTURE.md,
    docs/SPEC.md, and docs/NEXT_SESSION.md synchronized with implementation
    status and verified facts.
  - When the owner later asks for another chain, stop and follow the chain
    extension procedure in AI_CONTEXT.md: verify chain ID, Multicall3
    deployment, archive endpoints, pool/token metadata, and deployment bounds
    before changing the manifest or chain-scoped RPC code.
```
