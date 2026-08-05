# EVM Data SDK

Node.js-first TypeScript access to indexed EVM transactions, latest native balances, and ERC-20 transfers across Etherscan V2, Moralis, and scoped Alchemy endpoints.

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
