import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { EvmDataClient, isEvmDataError } from "evm-data-sdk";

const vlessUrl = requiredEnvironment("EVM_DATA_SDK_VLESS_URL");
const etherscanApiKey = requiredEnvironment("ETHERSCAN_API_KEY");
const singBoxCacheDir = resolve(process.env.SING_BOX_CACHE_DIR ?? join(process.cwd(), ".tools", "sing-box"));
const binaryPath = resolve(process.env.SING_BOX_BINARY_PATH ?? join(singBoxCacheDir, "1.13.16", `${process.platform}-${process.arch}`, process.platform === "win32" ? "sing-box.exe" : "sing-box"));

try {
  await access(binaryPath);
} catch {
  throw new Error("sing-box is not prewarmed. Run 'pnpm run prewarm:sing-box' before starting this example.");
}

const client = new EvmDataClient({
  providers: [{ kind: "etherscan", apiKeys: [etherscanApiKey] }],
  requestPolicy: { allowDirect: false },
  advancedProxy: {
    kind: "sing-box",
    urls: [vlessUrl],
    singBox: {
      version: "1.13.16",
      binaryPath,
      downloadMode: "eager",
    },
  },
});

try {
  await client.initialize();
  const balance = await client.address.getNativeBalance({
    chain: "ethereum",
    address: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  });
  console.log(`Managed sing-box proxy is ready. Ethereum balance response: ${balance.amount} wei.`);
} catch (error) {
  const code = isEvmDataError(error) ? error.code : "UNKNOWN_ERROR";
  console.error(`Managed proxy request failed: ${code}`);
  process.exitCode = 1;
} finally {
  await client.close();
}

function requiredEnvironment(name) {
  const value = process.env[name]?.trim();
  if (value === undefined || value === "") throw new Error(`Missing required environment variable: ${name}.`);
  return value;
}
