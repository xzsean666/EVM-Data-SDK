import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { prewarmSingBox } from "evm-data-sdk";

const version = "1.13.16";
const cacheDir = resolve(process.env.SING_BOX_CACHE_DIR ?? join(process.cwd(), ".tools", "sing-box"));

assertProxyIsEnabledAtNodeStartup();
await mkdir(cacheDir, { recursive: true, mode: 0o700 });
const binaryPath = await prewarmSingBox({ version, cacheDir });
console.log(`sing-box ${version} is checksum-verified and ready at ${binaryPath}`);

function assertProxyIsEnabledAtNodeStartup() {
  const hasProxy = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"].some((name) => process.env[name] !== undefined);
  const hasNodeProxySupport = process.env.NODE_USE_ENV_PROXY === "1" || process.execArgv.includes("--use-env-proxy");
  if (hasProxy && !hasNodeProxySupport) {
    throw new Error("A proxy was configured, but Node was not started with NODE_USE_ENV_PROXY=1 (or --use-env-proxy).");
  }
}
