# AI Context Handoff — DeFi Exchange Rate Snapshot

This is the durable context for a future AI session extending the module. It
is intentionally self-contained but does not replace reading the actual files.

## Current repository and feature boundary

The SDK is a strict Node.js TypeScript library. Existing exact-block RPC code
is in `src/rpc/`: `ArchiveRpcTransport.ts` is direct-only and always passes
`proxy: null`; `EthereumArchiveRpcPool.ts` probes endpoints and tracks passive
health; `EthereumArchiveRpcExecutor.ts` pins an operation and restarts after
retryable failure; `EthereumMulticall3Codec.ts` encodes/decodes Multicall3;
`RpcService.ts` validates calls and maps batch results. Chainlink uses this path
through `src/chainlink/` and must remain behaviorally compatible.

The new module belongs in `src/defi/`, with public domain types in
`src/domain/defiExchangeRateModels.ts` and request normalization in a matching
domain file. It is exposed as `client.defi`, independent from
`client.token.getPriceHistory()` and `client.chainlink`.

Implementation record (2026-08-08): `DeFiExchangeRateService`, the committed
registry, and pure adapters now exist. The registry is intentionally static;
before changing any entry, re-verify the supplied address, decimals,
underlying, deployment height, selector, and fixture.

Verification update (2026-08-07 follow-up): Base's Multicall3 deployment block
and public archive candidate pool were live-probed directly (no proxy). All 14
Ethereum registry addresses were re-checked with `eth_getCode` and have
deployed bytecode. Base's registry had three fabricated/incorrect underlying
addresses (`USDbC`, `cbETH`, `wstETH` underlyings on the three Aave V3 `aToken`
entries) that returned empty `eth_getCode`; these were corrected against the
official `bgd-labs/aave-address-book` `AaveV3BaseAssets` Solidity source and
re-confirmed on-chain. All 10 Base registry addresses (5 aTokens + 5
underlyings) now return non-empty bytecode on `base.drpc.org`. The five Aave
V3 `aToken` addresses themselves were correct in the original registry; only
their `underlyings` legs were wrong.

## Required source inventory

Read these before editing:

```text
src/client/EvmDataClient.ts
src/domain/configuration.ts
src/domain/errors.ts
src/domain/rpcModels.ts
src/rpc/RpcService.ts
src/rpc/EthereumArchiveRpcPool.ts
src/rpc/EthereumArchiveRpcExecutor.ts
src/rpc/EthereumMulticall3Codec.ts
src/rpc/ArchiveRpcTransport.ts
src/rpc/builtinEthereumArchiveRpcs.ts
src/chainlink/ChainlinkService.ts
src/index.ts
tests/unit/rpc-service.test.ts
tests/unit/ethereum-archive-rpc-pool.test.ts
tests/unit/ethereum-archive-rpc-executor.test.ts
tests/unit/client.test.ts
```

## Chain/runtime facts

Ethereum is chain ID 1; Base is chain ID 8453 (`0x2105`). Multicall3 uses
`0xcA11bde05977b3631167028862bE2a173976CA11` on both chains according to the
official Multicall3 deployment registry. Ethereum's verified deployment block
is `14353601`. Base's verified deployment block is `5022` (confirmed
2026-08-07: `eth_getCode` on `0xcA11bde05977b3631167028862bE2a173976CA11`
returns empty at block `5021` and the canonical Multicall3 bytecode at block
`5022`, checked against `base.drpc.org`, `base-mainnet.public.blastapi.io`,
and `base.meowrpc.com`). The built-in Base candidate pool is
`base-drpc`/`base-blastapi`/`base-meowrpc`; `base.publicnode.com` was checked
and rejected because it answers `eth_chainId` correctly (`0x2105`) but returns
`"Archive requests require a personal token"` for both `eth_getCode` and
`eth_call` at a historical block, the same failure mode already recorded for
Ethereum's PublicNode entry in
`docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md` section 3. These are
candidate URLs, not uptime guarantees; only stable IDs are public.

Existing Ethereum candidates are in `src/rpc/builtinEthereumArchiveRpcs.ts`.
Expand them only after a bounded historical `getBlockNumber()` check. A pool
is chain-scoped and must reject a wrong `eth_chainId` during initialization.

## Protocol model and initial registry

`DeFiTokenDefinition` contains `id`, chain ID, protocol, kind, token address,
symbol/name, token decimals, underlying legs, adapter kind, and optional
deployment block. Adapter call plans produce deterministic IDs; service sends
all dynamic calls through one `RpcService.multicallAtBlock()` invocation.

Initial reliable Ethereum addresses include:

- stETH `0xae7ab96520de3a18e5e111b5eaab095312d7fe84` (fixed 1:1 ETH),
- wstETH `0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0` (`stEthPerToken()`),
- rETH `0xae78736cd615f374d3085123a210448e74fc6393` (`getExchangeRate()`),
- sfrxETH `0xac3e018457b222d93114458476f3e3416abbe38f`
  (`convertToAssets()` to frxETH), but do not add it to the default registry
  until a committed Chainlink identity for frxETH exists,
- Compound cDAI `0xf5dce57282a584d2746faf1593d3121fcac444dc` and cUSDC
  `0x39aa39c021dfbae8fac545936693ac917d5e7563` (`exchangeRateStored()`),
- Aave V2 aDAI `0x018008bfb33d285247a21d44e50697654f754e63` and aUSDC
  `0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c` (fixed raw-unit mapping),
- Sky sDAI `0x83f20f44975d03b1b09e64809b757c47f942beea` (ERC-4626),
- Uniswap V2 WETH/USDC LP `0xb4e16d0168e52d35cacd2c6185b44281ec28c9dc`
  (`getReserves()` + `totalSupply()`).

Base Aave V3 addresses are generated by the official bgd-labs address book:

- aWETH `0xd4a0e0b9149bcee3c920d2e00b5de09138fd8bb7`,
- aUSDbC `0x0a1d576f3efef75b330424287a95a366e8281d54`,
- aUSDC `0x4e65fe4dba92790696d040ac24aa414708f5c0ab`,
- acbETH `0xcf3d55c10db69f28fd1a75bd73f3d8a2d9c595ad`,
- awstETH `0x99cbc45ea5bb7ef3a5bc08fb1b7e56bb2442ef0d`.

All addresses, decimals, underlying identities, and deployment heights must
be rechecked and recorded before treating them as production verified. The
registry should include only entries with a known adapter/ABI and clear raw
unit semantics. Every default registry underlying must include a
`chainlinkAssetSymbol` present in the committed Chainlink manifest; the
deterministic registry test enforces this. Do not infer rates from market price
or TVL APIs.

## Selector and arithmetic facts

Use hand-encoded selectors already verified by ABI/4byte and fixture tests:
`stEthPerToken()` `0x035faf82`, `getExchangeRate()` `0xe6aa216c`,
`convertToAssets(uint256)` `0x07a2d13a`, `exchangeRateStored()` `0x182df0f5`,
`getReserves()` `0x0902f1ac`, and `totalSupply()` `0x18160ddd`.
Compound conversion is `cTokenRaw * mantissa / 1e18`. ERC-4626 conversion
returns underlying raw units for the encoded sample share amount. LP legs are
`reserveRaw * sampleLp / totalSupplyRaw`, with integer floor division.

## Future chain/protocol procedure

1. Follow `Agent.md` Step 0/1; propose architecture and obtain owner approval
   for material public/configuration changes.
2. Verify chain ID, Multicall3 address/deployment, at least two archive
   endpoints, official token/protocol addresses, ABI selectors, decimals, and
   deployment blocks. Record evidence in `docs/INTEGRATIONS.md`.
3. Update `SPEC.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `NEXT_SESSION.md`, and
   the docs in this directory before source.
4. Add pure adapter/manifest fixtures, then service/client/fallback tests.
5. Run all package checks and only then perform opt-in live probes. Never log
   endpoint URLs, calldata, returndata, or token amounts.

## Hard invariants

Direct-only RPC; no timers; one endpoint per operation; random healthy order;
full restart on endpoint failure; block hash pre/post guard; per-token partial
failure; exact decimal strings; no runtime discovery; no generic `utils`,
`base`, or `manager` module; no automatic quota-bypass claims.
