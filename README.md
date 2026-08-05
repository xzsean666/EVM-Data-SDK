# EVM Data SDK

Node.js-first TypeScript access to indexed EVM data plus provider-separated daily token price history. Blockchain reads use Etherscan V2, Moralis, and scoped Alchemy; price history uses public Binance Spot, OKX Spot, Coinbase Exchange, and GeckoTerminal endpoints.

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

List `nextCursor` values are SDK-owned and provider-pinned. Pass the same filters and cursor back unchanged for the next page. Alchemy supports latest balances and one ERC-20 direction only; it is intentionally excluded from transaction history and both-direction transfer queries.

Run deterministic checks with `pnpm check`. Live provider tests are opt-in and never require the SDK itself to read environment files.

## Token price history

`client.token.getPriceHistory()` accepts a symbol or common name with a UTC `latest`, `date`, or inclusive `between` selector. For example:

`{ token: "Ethereum", range: { kind: "latest", days: 30 } }`.

The default source order is Binance, OKX, Coinbase, then GeckoTerminal. Each source returns daily open/high/low/close, decimal-string volume, `price === close`, ascending UTC dates, and explicit `missingDates`; no gap is filled with zero or a prior value. Binance and OKX use USDT markets while Coinbase and GeckoTerminal use USD. The SDK does not silently convert quotes.

Price sources do not require an API key. Price routing defaults to `direct`, which explicitly uses the local route. Set `price.routeMode` to `"proxy-only"` to use only explicitly configured HTTP(S) proxies; it never falls back to direct, and an unavailable route returns `PROXY_ERROR`. Successful sources are returned independently with explicit `failures`; if all enabled sources fail, the operation rejects with `PRICE_DATA_UNAVAILABLE`.
