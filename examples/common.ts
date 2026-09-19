import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EvmDataClient } from "../dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** 项目根目录下的 .env.key 或 .env 路径 */
export function getEnvKeyPath(): string {
  const envKeyPath = path.resolve(__dirname, "../.env.key");
  const envPath = path.resolve(__dirname, "../.env");
  if (fs.existsSync(envKeyPath)) {
    return envKeyPath;
  }
  if (fs.existsSync(envPath)) {
    return envPath;
  }
  return envKeyPath;
}

/** 常用测试地址与合约 */
export const TEST_ADDRESSES = {
  /** Vitalik Buterin 的地址 (vitalik.eth) */
  VITALIK: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
  /** Ethereum 主网 USDC 合约地址 */
  USDC_ETHEREUM: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  /** Ethereum 主网 USDT 合约地址 */
  USDT_ETHEREUM: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  /** Ethereum 主网 DAI 合约地址 */
  DAI_ETHEREUM: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
  /** Base 主网 USDC 合约地址 */
  USDC_BASE: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
} as const;

/**
 * 创建用于运行 Example 的标准 EvmDataClient 实例
 */
export function createExampleClient(overrides: Partial<ConstructorParameters<typeof EvmDataClient>[0]> = {}): EvmDataClient {
  const envFilePath = getEnvKeyPath();
  const hasEnvFile = fs.existsSync(envFilePath);

  return new EvmDataClient({
    ...(hasEnvFile ? { envFilePath } : {}),
    chainlink: { enabled: true },
    defi: { enabled: true },
    uniswapV3: { enabled: true },
    uniswapV4: { enabled: true },
    price: {
      providers: [
        { kind: "binance" },
        { kind: "gate" },
        // { kind: "okx" },
        // { kind: "coinbase" },
        // { kind: "geckoterminal" },
      ],
    },
    logger: (event) => {
      // 仅在需要排查底层调用时打印，或者静默
      // console.log(`   [Telemetry] op=${event.operation} provider=${event.provider} outcome=${event.outcome} duration=${event.durationMs}ms`);
    },
    ...overrides,
  });
}

/** 打印模块大标题 */
export function printHeader(title: string): void {
  console.log("\n==================================================");
  console.log(` 🚀 ${title}`);
  console.log("==================================================");
}

/** 打印小节标题 */
export function printSection(title: string): void {
  console.log(`\n📌 ${title}`);
  console.log("--------------------------------------------------");
}
