import path from "node:path";
import { fileURLToPath } from "node:url";
import { EvmDataClient, EnvLoader } from "../dist/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootEnvKeyPath = path.resolve(__dirname, "../.env.key");

async function runDemo() {
  console.log("==================================================");
  console.log(" 🚀 EVM Data SDK - Env & Multi-chain RPC Demo     ");
  console.log("==================================================\n");

  // 1. Initialize EnvLoader pointing to .env.key (or custom env file)
  console.log(`[1] Inspecting environment keys from: ${rootEnvKeyPath}`);
  const envLoader = new EnvLoader({ filePath: rootEnvKeyPath });

  // 2. Multi-chain RPC Key Resolution (NodeReal, Ankr, Alchemy, DRPC, Infura, etc.)
  const ethEndpoints = envLoader.getRpcEndpoints("ethereum");
  const baseEndpoints = envLoader.getRpcEndpoints("base");
  const bscEndpoints = envLoader.getRpcEndpoints("bsc");
  const polyEndpoints = envLoader.getRpcEndpoints("polygon");
  const arbEndpoints = envLoader.getRpcEndpoints("arbitrum");
  const optEndpoints = envLoader.getRpcEndpoints("optimism");

  console.log("\n[2] 🌐 Resolved Multi-chain Archive RPC Endpoints:");
  console.log(` - Ethereum Endpoints (${ethEndpoints.length}):`, ethEndpoints.map((e) => e.id));
  console.log(` - Base Endpoints     (${baseEndpoints.length}):`, baseEndpoints.map((e) => e.id));
  console.log(` - BSC Endpoints      (${bscEndpoints.length}):`, bscEndpoints.map((e) => e.id));
  console.log(` - Polygon Endpoints  (${polyEndpoints.length}):`, polyEndpoints.map((e) => e.id));
  console.log(` - Arbitrum Endpoints (${arbEndpoints.length}):`, arbEndpoints.map((e) => e.id));
  console.log(` - Optimism Endpoints (${optEndpoints.length}):`, optEndpoints.map((e) => e.id));

  // 3. Indexed Provider Keys
  const providers = envLoader.getProviderConfigs();
  console.log("\n[3] 🔑 Resolved Indexed Data Providers:");
  providers.forEach((p) => {
    console.log(` - Provider: ${p.kind} (${p.apiKeys.length} key(s) in pool)`);
  });

  // 4. Instantiate SDK Client directly passing the env file path!
  console.log("\n[4] ⚡ Initializing EvmDataClient directly with envFilePath:");
  const client = new EvmDataClient({
    envFilePath: rootEnvKeyPath,
    chainlink: { enabled: true },
    defi: { enabled: true },
    uniswapV3: { enabled: true },
    price: {
      providers: [
        { kind: "binance" },
        { kind: "okx" },
        { kind: "coinbase" },
        { kind: "geckoterminal" },
      ],
    },
    logger: (event) => {
      console.log(`   [Telemetry Log] op=${event.operation} provider=${event.provider} outcome=${event.outcome} duration=${event.durationMs}ms`);
    },
  });

  // 5. Run Price Aggregation Test (Free APIs, no key required)
  console.log("\n[5] 📈 Testing Token Price Fetching (ETH & BTC)...");
  try {
    const ethPrice = await client.token.getPriceHistory({
      token: "ETH",
      range: { kind: "latest", days: 1 },
    });
    const latestPoint = ethPrice.points[ethPrice.points.length - 1];
    console.log(`   ✅ ETH Price (Latest 1 day): $${latestPoint?.close ?? "N/A"} (Data points: ${ethPrice.points.length})`);

    const btcPrice = await client.token.getPriceHistory({
      token: "BTC",
      range: { kind: "latest", days: 1 },
    });
    const btcLatest = btcPrice.points[btcPrice.points.length - 1];
    console.log(`   ✅ BTC Price (Latest 1 day): $${btcLatest?.close ?? "N/A"} (Data points: ${btcPrice.points.length})`);
  } catch (err: any) {
    console.error("   ❌ Price fetch failed:", err.message);
  }

  // 6. Run On-chain Query Test using the loaded provider pools
  console.log("\n[6] 🔗 Testing On-chain Address Queries (Vitalik's Address)...");
  const testAddress = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"; // vitalik.eth

  // 6.1 Native Balance
  try {
    const balance = await client.address.getNativeBalance({
      address: testAddress,
      chain: "ethereum",
    });
    console.log(`   ✅ Native Balance for ${testAddress}:`);
    console.log(`      Amount: ${balance.amount} wei (${(BigInt(balance.amount) / 10n**18n).toString()} ETH)`);
    console.log(`      Chain ID: ${balance.chainId}`);
  } catch (err: any) {
    console.error("   ❌ On-chain balance query failed:", err.message);
  }

  // 6.2 Normal Native Transactions History
  try {
    console.log(`\n   📜 Fetching Native Transactions for ${testAddress}...`);
    const txPage = await client.address.getTransactions({
      address: testAddress,
      chain: "ethereum",
      pageSize: 5,
    });
    console.log(`   ✅ Fetched ${txPage.items.length} transactions (Has Next Page: ${txPage.nextPageState !== null})`);
    txPage.items.forEach((tx, i) => {
      console.log(`      [${i + 1}] Hash: ${tx.hash} | Block: ${tx.blockNumber} | From: ${tx.from.slice(0, 8)}... -> To: ${tx.to?.slice(0, 8)}... | Value: ${tx.value} wei`);
    });
  } catch (err: any) {
    console.error("   ❌ Native transactions query failed:", err.message);
  }

  // 6.3 ERC-20 Token Transfers History
  try {
    console.log(`\n   🪙 Fetching ERC-20 Token Transfers for ${testAddress}...`);
    const tokenPage = await client.token.getErc20Transfers({
      address: testAddress,
      chain: "ethereum",
      direction: "incoming",
      pageSize: 5,
    });
    console.log(`   ✅ Fetched ${tokenPage.items.length} incoming ERC-20 transfers (Has Next Page: ${tokenPage.nextPageState !== null})`);
    tokenPage.items.forEach((transfer, i) => {
      console.log(`      [${i + 1}] Token: ${transfer.tokenSymbol ?? transfer.tokenAddress} | Amount: ${transfer.amount} | From: ${transfer.from.slice(0, 8)}... | Hash: ${transfer.transactionHash.slice(0, 10)}...`);
    });
  } catch (err: any) {
    console.error("   ❌ ERC-20 transfers query failed:", err.message);
  }

  console.log("\n==================================================");
  console.log(" 🎉 Example execution complete!");
  console.log("==================================================");
}

runDemo().catch((err) => {
  console.error("Fatal error running demo:", err);
  process.exit(1);
});
