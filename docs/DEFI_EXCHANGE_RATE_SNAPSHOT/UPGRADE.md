# DeFi Exchange Rate Snapshot Module — Upgrade Specification

Version: 0.5.0

Status: implemented with deterministic fixture coverage on 2026-08-08; live
endpoint availability remains opt-in and unverified in this change.

## Implementation status

- `src/rpc/` now parameterizes Archive RPC pools and `RpcService` by chain ID
  and Multicall3 deployment boundary. Ethereum remains backward compatible;
  Base uses its own committed candidate list and `0x2105` health probe.
- `src/defi/` contains the committed registry, pure call-plan/decoder adapters,
  and `DeFiExchangeRateService`. It is exposed as nullable `client.defi`.
- Built-in endpoint candidates default to enabled. Set
  `defi.useBuiltinArchiveRpcs: false` to use only explicit per-chain endpoints.
- Default tests use only fixtures. No endpoint URL, calldata, return data, or
  token amount is emitted by a live test because no live test was run here.

## Goal

Add a read-only module that returns historical DeFi exchange rates at one
exact Ethereum Mainnet or Base Mainnet block. It must use Archive RPC,
`blockTag`, and Multicall3; it must never use `latest`, floating point, REST
token discovery, or a proxy route for these reads.

## Public API

```ts
const client = new EvmDataClient({
  defi: {
    enabled: true,
    // Optional. Built-ins are enabled by default for Ethereum and Base.
    chains: ["ethereum", "base"],
    rpcEndpoints: {
      base: [{ id: "base-company-archive", url: process.env.BASE_ARCHIVE_RPC! }],
    },
  },
});
await client.initialize();

const snapshot = await client.defi.getExchangeRatesAtBlock({
  chain: "base",
  blockNumber: "25000000",
  // tokenIds: ["base:aave-v3:ausdc"],
});
```

Result quantities are canonical decimal strings:

```ts
interface DeFiExchangeRateSnapshot {
  chainId: 1 | 8453;
  blockNumber: string;
  blockHash: string;
  blockTimestamp: string;
  registryVersion: string;
  rpcEndpointId: string;
  executionMode: "multicall3";
  rates: readonly {
    tokenId: string;
    tokenAddress: string;
    tokenSymbol: string;
    tokenDecimals: number;
    kind: "lst" | "lending" | "vault" | "lp";
    protocol: string;
    underlyings: readonly {
      address: string | null;
      symbol: string;
      decimals: number;
      isNative: boolean;
      amount: string;
    }[];
  }[];
  failures: readonly {
    tokenId: string;
    tokenAddress: string;
    code: "CALL_REVERTED" | "NOT_DEPLOYED_AT_BLOCK" | "RESPONSE_INVALID" | "ADAPTER_INVALID";
    retryable: boolean;
    message: string;
  }[];
  summary: {
    configuredTokens: number;
    requestedTokens: number;
    succeededTokens: number;
    failedTokens: number;
    multicallBatches: number;
    partial: boolean;
  };
}
```

`underlyings` is an array because LP tokens are baskets. For a one-asset
vault/lending/LST token it has one leg. The amount is the underlying raw
quantity received for the manifest's canonical `sampleTokenAmount` (normally
one whole token, `10 ** tokenDecimals`). Consumers can calculate a ratio from
`amount / sampleTokenAmount` using integer arithmetic.

## Archive RPC pool behavior

- Ethereum and Base have separate built-in candidate lists. A Base endpoint is
  never probed using Ethereum's chain ID or deployment boundary.
- `initialize()` probes every configured endpoint concurrently and marks only
  endpoints passing `eth_chainId`, an exact historical block header, and
  Multicall3 `getBlockNumber()` as healthy.
- Every operation creates a random permutation of currently healthy endpoints,
  pins the full pre-header/batches/post-header sequence to one endpoint, and
  never repeats an endpoint during that operation.
- A retryable transport, archive-depth, or reorg error discards all partial
  batch data and restarts the entire operation on the next endpoint. A feed or
  protocol call revert is not an endpoint failure.
- Transport is direct-only (`proxy: null`) and does not read proxy environment
  variables. Endpoint URLs never appear in public results, errors, logs, or
  cursors; only stable IDs are exposed.

## Protocol adapters

The initial adapters are pure call-plan/decoder modules:

| Adapter | State read | Mapping |
| --- | --- | --- |
| `fixed-ratio` | no call | guaranteed one raw token unit -> one raw underlying unit |
| `aave-v2` / `aave-v3` | Pool `getReserveNormalizedIncome(asset)` | sample aToken x ray income / 1e27 |
| `wstETH` | `stEthPerToken()` | returned stETH amount for one wstETH sample |
| `rocket-rETH` | `getExchangeRate()` | ETH wei per rETH sample, 1e18 scale |
| `cbeth` | Coinbase `exchangeRate()` | ETH wei per cbETH sample, 1e18 scale |
| `erc4626` | `convertToAssets(sample)` | vault assets for sample shares |
| `compound-v2` | `exchangeRateStored()` | `ctokenRaw * mantissa / 1e18` |
| `uniswap-v2-lp` | `getReserves()` + `totalSupply()` | each reserve × sample LP / total supply |
| `curve-3pool-lp` | 3pool `balances(0..2)` + LP `totalSupply()` | each pool balance × sample LP / total supply |
| `fixed-ratio` (Compound V3 Comet) | Comet ERC-20 base balance units | one Comet base unit is one base-token unit; interest is reflected in `balanceOf`, not a share exchange rate |
| `aerodrome-lp` | Pool `getReserves()` + LP `totalSupply()` | each reserve × sample LP / total supply |
| `balancer-bpt` | Vault `getPoolTokens(poolId)` + BPT `totalSupply()` | each Vault balance × sample BPT / total supply |

The default registry is a reviewed allowlist: every underlying leg has a
committed Chainlink asset identity. Aave V2/V3 addresses and decimals come
from the official `bgd-labs/aave-address-book`; aToken rates are dynamic and
are never treated as fixed 1:1. Ethereum includes Lido/Rocket Pool, Aave,
Compound V2, Sky sDAI, and Uniswap V2 mappings. Base includes the
Chainlink-identity intersection of current Aave V3 reserves. Assets without a
committed underlying identity, including frxETH/sfrxETH, are excluded.
Entries with a deployment block are rejected as `NOT_DEPLOYED_AT_BLOCK` before
creating calls when the requested block is earlier.

The dated protocol coverage decision and explicit exclusions are recorded in
[`PROTOCOL_INVENTORY.md`](./PROTOCOL_INVENTORY.md).

## Adding a chain/protocol

Read `AI_CONTEXT.md`, verify official addresses, ABI selectors, decimals,
underlying identity, deployment blocks, Multicall3 deployment, and at least two
healthy public archive endpoints. Add fixtures before live checks. Never fetch
or mutate the manifest at runtime.

## Acceptance

`pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:package`,
and `pnpm check` pass. Default tests perform no network I/O. Live smoke tests
must be opt-in and may report only chain, endpoint ID, counts, and error codes.
