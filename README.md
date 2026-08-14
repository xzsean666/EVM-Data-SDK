# EVM Data SDK

Node.js-first TypeScript access to indexed EVM data plus provider-separated daily token price history. Blockchain reads use Etherscan V2, Moralis, and scoped Alchemy; price history uses public Binance Spot, OKX Spot, Coinbase Exchange, and GeckoTerminal endpoints.

Persistent sync is enabled with `storage: { url: "sqlite:./data/evm-data-sdk.db" }`.
Call `initialize()` before `sync.update()` and `close()` when finished. The
client exposes durable `sync`, `price`, and revisioned `history` operations;
chain quantities are returned as decimal strings. PostgreSQL URLs use the
bundled `pg` adapter and require a reachable database at initialization time.

Use `client.sync.getStatus()` and `client.price.getSyncStatus()` for scoped
progress inspection. Price ranges continue from the persisted timestamp when
`fromTimestamp` is omitted; use `client.price.resetPriceSync()` only for an
explicitly selected token/market scope. Binance supports configured candle
intervals; other configured price exchanges support daily (`1d`) persistence.

```ts
import { EvmDataClient } from "evm-data-sdk";

const client = new EvmDataClient({
  providers: [
    { kind: "etherscan", apiKeys: [process.env.ETHERSCAN_API_KEY!] },
    { kind: "moralis", apiKeys: [process.env.MORALIS_API_KEY!] },
    { kind: "alchemy", apiKeys: [process.env.ALCHEMY_API_KEY!] },
  ],
  requestPolicy: {
    allowDirect: false,
  },
  proxies: [
    { url: process.env.HTTP_PROXY_URL! },
  ],
});

const transactions = await client.address.getTransactions({
  chain: "ethereum",
  address: "0x0000000000000000000000000000000000000000",
  pageSize: 50,
});

const balance = await client.address.getNativeBalance({
  chain: 1,
  address: "0x0000000000000000000000000000000000000000",
});

const transfers = await client.token.getErc20Transfers({
  chain: "ethereum",
  address: "0x0000000000000000000000000000000000000000",
  direction: "incoming",
});
```

`allowDirect: false` requires every request to use a configured HTTP(S) proxy. With `allowDirect: true` and at least one proxy, requests round-robin through each proxy and the local direct route. With no proxies, the client uses the local route only.

List `nextCursor` values are SDK-owned and provider-pinned. Pass the same filters and cursor back unchanged for the next page. `pageSize` defaults to 50; valid values are 1–10,000. Provider eligibility is automatic: 1–100 can use Moralis, ERC-20 requests up to 1,000 can use Alchemy, and 1,001–10,000 use Etherscan or a chain-compatible Blockscout configuration. Alchemy supports incoming, outgoing, and both-direction ERC-20 queries; its both-direction mode fetches one page per direction, returns their full de-duplicated union (up to `2 × pageSize` records), and uses one Alchemy-pinned dual cursor. Set `fullData: true` to restrict routing to Etherscan-compatible providers and, when `pageSize` is omitted, request a 10,000-record logical page. `fullData` does not combine every historical page: continue with `nextCursor` to retrieve additional records. Alchemy remains intentionally excluded from normal transaction history.

Run deterministic checks with `pnpm check`. Live provider tests are opt-in and never require the SDK itself to read environment files.

## Token price history

`client.token.getPriceHistory()` accepts a symbol or common name with a UTC `latest`, `date`, or inclusive `between` selector. For example:

`{ token: "Ethereum", range: { kind: "latest", days: 30 } }`.

The default source order is Binance, OKX, Coinbase, then GeckoTerminal. Each source returns daily open/high/low/close, decimal-string volume, `price === close`, ascending UTC dates, and explicit `missingDates`; no gap is filled with zero or a prior value. Binance and OKX use USDT markets while Coinbase and GeckoTerminal use USD. The SDK does not silently convert quotes.

Price sources do not require an API key. Price routing defaults to `direct`, which explicitly uses the local route. Set `price.routeMode` to `"proxy-only"` to use only explicitly configured HTTP(S) proxies; it never falls back to direct, and an unavailable route returns `PROXY_ERROR`. Successful sources are returned independently with explicit `failures`; if all enabled sources fail, the operation rejects with `PRICE_DATA_UNAVAILABLE`.

## Chainlink historical prices via Ethereum Archive RPC

`client.chainlink.getTokenPricesAtBlock()` reads every configured Chainlink
Ethereum Mainnet Crypto/USD price feed's `latestRoundData()` as of a specific
historical block, in one batched `Multicall3.aggregate3` call. This is an
opt-in feature, off by default:

```ts
import { EvmDataClient } from "evm-data-sdk";

const client = new EvmDataClient({
  chainlink: { enabled: true },
});

const result = await client.chainlink.getTokenPricesAtBlock({
  blockNumber: "18000000",
});

for (const price of result.prices) {
  console.log(price.asset.symbol, price.price, price.isStale);
}
```

With `chainlink.enabled: true` and no other configuration, the SDK selects a
random built-in public Ethereum Archive RPC endpoint per call from
`src/rpc/builtinEthereumArchiveRpcs.ts` (see
[`docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md`](./docs/CHAINLINK_ETHEREUM_ARCHIVE_RPC_MAINTENANCE.md)
for how that registry is maintained and verified). Supply your own endpoint(s)
instead with `chainlink.rpcEndpoints` and `chainlink.useBuiltinEthereumArchiveRpcs: false`:

```ts
const client = new EvmDataClient({
  chainlink: {
    enabled: true,
    useBuiltinEthereumArchiveRpcs: false,
    rpcEndpoints: [{ id: "company-archive-1", url: process.env.ETH_RPC_URL! }],
  },
});
```

Archive RPC requests are always direct HTTPS: this feature never reads
`HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY`/`NO_PROXY` and never routes through the
configured proxy pool. Each feed's result reports its own success or a
`ChainlinkFeedFailure`, so a single unavailable or reverting feed does not
fail the whole call; `result.summary.partial` is `true` whenever at least one
feed failed while others succeeded. The underlying public primitive,
`client.rpc.multicallAtBlock()`, is also exported for callers who need raw
Multicall3 batching without the Chainlink decoding layer.

To add another chain (for example Base) to this Chainlink/Archive RPC/Multicall3
feature, start from
[`docs/CHAINLINK_ARCHIVE_RPC_MULTICALL3_ADD_CHAIN_HANDOFF.md`](./docs/CHAINLINK_ARCHIVE_RPC_MULTICALL3_ADD_CHAIN_HANDOFF.md)
instead of exploring the codebase from scratch — it maps every Ethereum-specific
file and decision point that must be revisited.

## DeFi exchange-rate snapshots

`client.defi.getExchangeRatesAtBlock()` returns committed DeFi token-to-
underlying exchange rates at one exact Ethereum Mainnet or Base Mainnet block.
It is opt-in, initializes direct-only Archive RPC pools explicitly, and never
uses `latest`, a proxy route, market prices, or runtime token discovery.

```ts
const client = new EvmDataClient({
  defi: {
    enabled: true,
    chains: ["ethereum", "base"],
    rpcEndpoints: {
      base: [{ id: "company-base-archive", url: process.env.BASE_ARCHIVE_RPC! }],
    },
  },
});
await client.initialize();

const snapshot = await client.defi.getExchangeRatesAtBlock({
  chain: "base",
  blockNumber: "25000000",
});
```

Set `defi.useBuiltinArchiveRpcs: false` to use only explicit per-chain
`rpcEndpoints`; construction rejects an enabled chain with no remaining
endpoint candidate.

All amounts are decimal strings. Each successful token has one or more
`underlyings`; LP tokens deliberately retain separate reserve legs. Protocol
reverts and malformed data are per-token failures, while an endpoint/archive
failure restarts the complete request on another healthy endpoint. Endpoint
URLs are never returned; only the stable endpoint ID appears in a snapshot.
See [`docs/DEFI_EXCHANGE_RATE_SNAPSHOT/UPGRADE.md`](./docs/DEFI_EXCHANGE_RATE_SNAPSHOT/UPGRADE.md)
for the full contract and extension procedure.

## Planned upgrades

A staged implementation prompt for gpt-terra is in
[`docs/GPT_TERRA_IMPLEMENTATION_PROMPT.md`](./docs/GPT_TERRA_IMPLEMENTATION_PROMPT.md).

## Blockscout provider

Blockscout Etherscan-compatible account APIs use the same SDK methods and
response models as Etherscan. Configure an instance and its own API-key pool:

```ts
const client = new EvmDataClient({
  providers: [{
    kind: "blockscout",
    apiKeys: [process.env.BLOCKSCOUT_API_KEY!],
    baseUrl: "https://eth.blockscout.com/api",
  }],
});
```

When Etherscan and Blockscout are both configured, the existing router and
bounded executor select among compatible candidates and rotate only the
selected provider's credentials. Results preserve the common model while
reporting `provider: "blockscout"`; API keys and upstream URLs are never
returned. See [`docs/BLOCKSCOUT_PROVIDER/UPGRADE.md`](./docs/BLOCKSCOUT_PROVIDER/UPGRADE.md)
for the contract and [`docs/BLOCKSCOUT_PROVIDER/AI_IMPLEMENTATION_PROMPT.md`](./docs/BLOCKSCOUT_PROVIDER/AI_IMPLEMENTATION_PROMPT.md)
for the implementation handoff.
