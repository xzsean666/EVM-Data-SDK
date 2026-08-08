# gpt-terra Task Breakdown

This is the bounded execution queue for implementing and maintaining the
module. Work packages are ordered; do not start the next package with a failing
previous package.

Implementation record, 2026-08-08: Packages 0 through 5 are implemented and
covered by deterministic tests. The required local verification suite passes.

Live verification record, 2026-08-07 (follow-up): a direct on-chain
`eth_getCode` sweep found and corrected three fabricated Base underlying
addresses and one non-functional Base archive candidate (see
`docs/INTEGRATIONS.md` section 18). After the fix, an opt-in
`client.defi.getExchangeRatesAtBlock()` run against the public built-in
Archive RPC pools succeeded with zero failures for all configured Ethereum
and Base tokens. Package 5's live-verification requirement is satisfied.

## Package 0 — Context and design gate

Read `Agent.md`, the canonical docs, and every file in `AI_CONTEXT.md`. Confirm
the public API, chain-scoped Archive RPC shape, LP multi-leg model, and the
non-negotiable direct-only/restart invariants. Update docs before source.

## Package 1 — Chain-scoped Archive RPC and public pools

Generalize the existing pool/executor/RpcService with expected chain ID,
Multicall3 address, and deployment block. Preserve all Ethereum tests and
backward-compatible Ethereum behavior. Add `builtinBaseArchiveRpcs.ts`, expand
the Ethereum candidate list, and add deterministic tests for wrong-chain
probes, random healthy ordering, endpoint failure marking, and full restart.

## Package 2 — Domain contracts and registry

Add DeFi request/result/failure types, strict request normalization, adapter
interfaces, registry version hashing, and committed Ethereum/Base token
definitions. Use decimal strings and nullable native addresses only in the
underlying model. No network work belongs here.

## Package 3 — Pure protocol adapters

Implement and fixture-test `fixed-ratio`, `wstETH`, `rocket-rETH`, `erc4626`,
`compound-v2`, and `uniswap-v2-lp`. Every decoder must reject malformed,
truncated, negative/zero-invalid, or dimensionally inconsistent return data.

## Package 4 — Service and client composition

Implement `DeFiExchangeRateService`, compose `client.defi`, add per-chain RPC
services/pools, merge DeFi endpoint configuration with explicit custom
endpoints without URL leakage, and make `initialize()` probe all enabled
chain pools. Keep Chainlink behavior unchanged.

## Package 5 — Verification and docs

Add service/client tests for partial results, all-failure error, token subset,
pre-deployment filtering, block pinning, batch count, and endpoint fallback.
Run all checks, update `NEXT_SESSION.md`, README, and the four documents in
this directory. Record live endpoint verification without printing URLs,
calldata, return data, or prices.

## Package 6 — Future extension procedure

When adding a chain or protocol, use `AI_CONTEXT.md` as the context handoff;
re-verify official facts, update integration evidence and manifest version,
add fixtures, then repeat Package 5. Do not silently broaden the registry.
