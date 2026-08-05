import { readFile } from "node:fs/promises";

export async function loadLiveKeys(file = ".env.key") {
  const lines = (await readFile(file, "utf8")).split(/\r?\n/);
  const result = { etherscan: [], alchemy: [], moralis: [] };
  let current = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === "Etherscan Multichain API") current = "etherscan";
    else if (line === "Alchemy API key") current = "alchemy";
    else if (line === "Moralis Data API") current = "moralis";
    else if (current !== null && line !== "" && !line.startsWith("#")) result[current].push(line);
  }
  return result;
}

export function createLiveConfiguration(keys, options = {}) {
  const providers = ["etherscan", "alchemy", "moralis"]
    .filter((kind) => keys[kind]?.length > 0)
    .map((kind) => ({ kind, apiKeys: keys[kind] }));
  const proxyUrl = options.proxyUrl ?? null;
  return {
    providers,
    requestPolicy: {
      allowDirect: options.allowDirect ?? proxyUrl === null,
      maxTotalAttempts: options.maxTotalAttempts ?? 2,
      totalTimeoutMs: options.totalTimeoutMs ?? 20_000,
    },
    ...(proxyUrl === null ? {} : { proxies: [{ url: proxyUrl }] }),
  };
}
