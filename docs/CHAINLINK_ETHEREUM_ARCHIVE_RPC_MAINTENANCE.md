# Chainlink Historical Prices via Ethereum Archive RPC — RPC Maintenance

Project: Chainlink Historical Prices via Ethereum Archive RPC and Multicall3 Upgrade

Project ID: `chainlink-ethereum-archive-rpc-multicall3`

Status: Maintenance plan for the v0.4 proposal

Last updated: 2026-08-07

## 1. Where RPC Endpoints Are Updated

After implementation, the only built-in endpoint registry must be:

```text
src/rpc/builtinEthereumArchiveRpcs.ts
```

Do not copy public endpoint URLs into `ChainlinkService`, tests, README, or
multiple provider modules. Unit tests use fake URLs. Opt-in live tests import
the built-in registry.

Application-owned authenticated endpoints are supplied through:

```ts
chainlink: {
  rpcEndpoints: [{ id: "company-archive-1", url: process.env.ETH_RPC_URL! }],
}
```

Environment reading belongs to the application. The SDK never reads it.

## 2. Current Candidate Set

These endpoints passed the historical probe described below on 2026-08-07:

| Stable ID | Endpoint | Probe result |
| --- | --- | --- |
| `drpc-public` | `https://eth.drpc.org` | passed |
| `blastapi-public` | `https://eth-mainnet.public.blastapi.io` | passed |
| `mevblocker-public` | `https://rpc.mevblocker.io` | passed |
| `nodies-public` | `https://eth-pokt.nodies.app` | passed |
| `tenderly-public` | `https://mainnet.gateway.tenderly.co` | passed |

The probe used Ethereum block `18,000,000` and called Multicall3
`getBlockNumber()` at that historical `blockTag`. Every listed endpoint
returned exactly `18,000,000`.

Public services can change rate limits, archive retention, methods, URLs,
authentication, privacy policy, or terms without changing this repository.
Passing once is not a permanent guarantee.

## 3. Candidates Rejected in the 2026-08-07 Check

The following were not suitable as unauthenticated built-ins at verification
time:

| Candidate | Observed reason |
| --- | --- |
| LlamaRPC | HTTP 521 during the check |
| PublicNode | archive request required a personal token |
| Ankr public URL | required an API key |
| 1RPC | anonymous usage limit was already exhausted |
| Flashbots | `eth_call` was not whitelisted |
| OnFinality public URL | historical state was unavailable |
| MEOWRPC | `eth_call` was unsupported |
| BlockPI public URL | HTTP 521 during the check |

Do not permanently blacklist these services. A later maintainer may recheck
them if official public/archive behavior changes.

## 4. Required Probe Before Adding an Endpoint

The implementation should provide an opt-in command such as:

```bash
pnpm probe:ethereum-archive-rpcs
```

For each candidate, it must use direct HTTP with environment proxy discovery
disabled and perform all of these checks under bounded timeouts:

1. `eth_chainId` returns `0x1`.
2. `eth_getBlockByNumber("0x112a880", false)` returns block `18,000,000`, a
   32-byte hash, and a valid timestamp.
3. `eth_call` to Multicall3
   `0xcA11bde05977b3631167028862bE2a173976CA11`, calldata `0x42cbb15c`
   (`getBlockNumber()`), with block tag `0x112a880`, returns `18,000,000`.
4. `eth_call` to the standard ETH/USD Chainlink proxy
   `0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419`, calldata `0xfeaf968c`
   (`latestRoundData()`), at the same block decodes as five ABI words with a
   positive answer and nonzero `updatedAt`.
5. Repeat the probe at least three times before accepting a new built-in. A
   temporary failure remains visible; the script must not silently report it
   as success.

The command prints stable endpoint IDs and pass/fail codes only. It must not
print endpoint URLs, response data, feed prices, custom tokens, headers, or
raw errors that may echo URLs.

For a deeper archive-retention review, a maintainer may add older probe blocks
that are not earlier than the verified Multicall3 deployment. One successful
probe block does not prove unbounded history.

## 5. Endpoint Acceptance Checklist

Before editing the registry, an AI or maintainer must confirm:

- the service has an official website/documentation page;
- the exact endpoint is documented or clearly published for public use;
- anonymous usage is allowed by current terms;
- Ethereum Mainnet chain ID and historical `eth_call` pass;
- HTTPS certificate and hostname validation pass;
- no API key, userinfo, query token, tracking token, or private tenant ID is in
  the built-in URL;
- the endpoint does not require a proxy;
- at least two other healthy built-ins remain after additions/removals;
- stable IDs are unique and do not encode the URL;
- verification date and reason for the diff are recorded in the commit/docs.

If official terms are unclear, do not add the endpoint as a built-in. Document
it as a caller-configurable candidate instead.

## 6. Safe Registry Edit Shape

The registry should remain immutable and reviewable:

```ts
export const BUILTIN_ETHEREUM_ARCHIVE_RPCS = Object.freeze([
  Object.freeze({ id: "drpc-public", url: "https://eth.drpc.org" }),
  // ...other independently operated endpoints...
]);
```

Do not store runtime health, request counters, mutable weights, credentials, or
last errors in this file. Those belong to an instance-local RPC pool.

Endpoint order must not determine request routing. The executor creates a
random permutation of currently healthy endpoint IDs for each operation.

## 7. Updating the Chainlink Feed Manifest Is Separate

RPC endpoint maintenance and Chainlink feed maintenance are independent.
Feed mappings are updated through:

```text
scripts/update-chainlink-ethereum-feeds.mjs
src/chainlink/ethereumMainnetPriceFeeds.generated.ts
```

Use Chainlink's official address page and the metadata source referenced by
the Chainlink documentation repository. Run the generator, inspect added,
removed, changed-address, changed-decimals, changed-heartbeat, SVR, and
deprecating entries, then run the full deterministic test suite. Never fetch
or mutate the feed manifest during SDK initialization.

## 8. AI Handoff Template for Future RPC Updates

The owner can give a future AI this request:

```text
Read Agent.md and docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md completely.
Find current unauthenticated public Ethereum Mainnet RPC endpoints whose
official terms permit public use and which support historical eth_call.
Do not edit source yet. First run the documented direct-only probe against each
candidate, report pass/fail by stable ID without printing URLs or responses,
and cite official provider documentation. After I approve the candidate set,
update only src/rpc/builtinEthereumArchiveRpcs.ts and the verification record,
add/update deterministic fixtures, run pnpm check, and do not push.
```

