import { EvmDataClient, isEvmDataError } from "../dist/index.js";
import { loadLiveKeys } from "./live-config.mjs";

const address = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const proxyUrl = process.env.EVM_SDK_LIVE_PROXY ?? null;

const keys = await loadLiveKeys(".env.key");
const available = [
  ["etherscan", keys.etherscan],
  ["alchemy", keys.alchemy],
  ["moralis", keys.moralis],
].filter((entry) => entry[1]?.length > 0);

console.log(JSON.stringify({
  phase: "config",
  providers: available.map(([kind, values]) => ({ kind, keyCount: values.length })),
  proxyConfigured: proxyUrl !== null,
  address,
}));

for (const [kind, values] of available) {
  await exerciseProvider(kind, values);
}

await exercisePageCapacity();

if (proxyUrl !== null) {
  for (const kind of ["etherscan", "alchemy", "moralis"]) {
    if (keys[kind]?.length > 0) await exerciseProxyModes(kind, keys[kind], proxyUrl);
  }
}

async function exerciseProvider(kind, apiKeys) {
  const provider = { kind, apiKeys };
  const client = new EvmDataClient({
    providers: [provider],
    requestPolicy: { maxTotalAttempts: 2, totalTimeoutMs: 20_000 },
  });

  await report(kind, "nativeBalance", () => client.address.getNativeBalance({ chain: "ethereum", address }));

  if (kind !== "alchemy") {
    await reportPaged(kind, "transactions", (cursor) => client.address.getTransactions({
      chain: "ethereum",
      address,
      pageSize: 5,
      order: "desc",
      ...(cursor === null ? {} : { cursor }),
    }));
    await reportPaged(kind, "erc20TransfersBothBlockRange", (cursor) => client.token.getErc20Transfers({
      chain: "ethereum",
      address,
      direction: "both",
      pageSize: 5,
      order: "desc",
      startBlock: "0",
      endBlock: "99999999",
      ...(cursor === null ? {} : { cursor }),
    }));
  } else {
    await reportPaged(kind, "erc20TransfersIncomingBlockRange", (cursor) => client.token.getErc20Transfers({
      chain: "ethereum",
      address,
      direction: "incoming",
      pageSize: 5,
      order: "desc",
      startBlock: "0",
      endBlock: "99999999",
      ...(cursor === null ? {} : { cursor }),
    }));
    await reportPaged(kind, "erc20TransfersOutgoingBlockRange", (cursor) => client.token.getErc20Transfers({
      chain: "ethereum",
      address,
      direction: "outgoing",
      pageSize: 5,
      order: "desc",
      startBlock: "0",
      endBlock: "99999999",
      ...(cursor === null ? {} : { cursor }),
    }));
    await reportPaged(kind, "erc20TransfersBothBlockRange", (cursor) => client.token.getErc20Transfers({
      chain: "ethereum",
      address,
      direction: "both",
      pageSize: 5,
      order: "desc",
      startBlock: "0",
      endBlock: "99999999",
      ...(cursor === null ? {} : { cursor }),
    }));
  }
}

async function exerciseProxyModes(kind, apiKeys, proxy) {
  const proxyOnly = new EvmDataClient({
    providers: [{ kind, apiKeys }],
    requestPolicy: { allowDirect: false, maxTotalAttempts: 1, totalTimeoutMs: 15_000 },
    proxies: [{ url: proxy }],
  });
  await report(kind, "proxyOnlyBalance", () => proxyOnly.address.getNativeBalance({ chain: "ethereum", address }));

  const mixed = new EvmDataClient({
    providers: [{ kind, apiKeys }],
    requestPolicy: { allowDirect: true, maxTotalAttempts: 1, totalTimeoutMs: 15_000 },
    proxies: [{ url: proxy }],
  });
  await report(kind, "mixedRouteBalance1", () => mixed.address.getNativeBalance({ chain: "ethereum", address }));
  await report(kind, "mixedRouteBalance2", () => mixed.address.getNativeBalance({ chain: "ethereum", address }));
}

async function exercisePageCapacity() {
  if (keys.alchemy.length > 0) {
    const alchemy = new EvmDataClient({
      providers: [{ kind: "alchemy", apiKeys: keys.alchemy }],
      requestPolicy: { maxTotalAttempts: 1, attemptTimeoutMs: 45_000, totalTimeoutMs: 60_000 },
    });
    await report("alchemy", "pageSize1000IncomingTransfers", () => alchemy.token.getErc20Transfers({
      chain: "ethereum",
      address,
      direction: "incoming",
      pageSize: 1_000,
      order: "desc",
    }));
  }

  if (keys.etherscan.length > 0) {
    const etherscan = new EvmDataClient({
      providers: [{ kind: "etherscan", apiKeys: keys.etherscan }],
      requestPolicy: { maxTotalAttempts: 1, attemptTimeoutMs: 45_000, totalTimeoutMs: 60_000 },
    });
    await report("etherscan", "fullDataTransactions", () => etherscan.address.getTransactions({
      chain: "ethereum",
      address,
      fullData: true,
      order: "desc",
    }));
  }
}

async function report(provider, operation, action) {
  try {
    const result = await action();
    console.log(JSON.stringify({ provider, operation, status: "ok", itemCount: Array.isArray(result.items) ? result.items.length : null, hasNextCursor: result.nextCursor !== undefined && result.nextCursor !== null }));
  } catch (error) {
    console.log(JSON.stringify({ provider, operation, status: "error", ...errorSummary(error) }));
  }
}

async function reportPaged(provider, operation, action) {
  let cursor = null;
  for (let page = 1; page <= 2; page += 1) {
    try {
      const result = await action(cursor);
      console.log(JSON.stringify({ provider, operation, page, status: "ok", itemCount: result.items.length, hasNextCursor: result.nextCursor !== null }));
      cursor = result.nextCursor;
      if (cursor === null) return;
    } catch (error) {
      console.log(JSON.stringify({ provider, operation, page, status: "error", ...errorSummary(error) }));
      return;
    }
  }
}

function errorSummary(error) {
  return isEvmDataError(error)
    ? { code: error.code, retryable: error.retryable, providerContext: error.provider, chainId: error.chainId }
    : { code: "UNEXPECTED_ERROR", retryable: false };
}
