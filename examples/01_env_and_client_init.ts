/**
 * 示例 01: 环境变量加载与客户端初始化 (EnvLoader & Client Initialization)
 *
 * 功能说明:
 * 1. 使用 EnvLoader 解析 .env.key 或 .env 配置文件。
 * 2. 自动根据多链 RPC 密钥 (NodeReal, Ankr, Alchemy, DRPC, Infura 等) 生成多链 Archive RPC 节点池。
 * 3. 解析各类数据索引服务商密钥池 (Etherscan, Blockscout, Alchemy Data API, Moralis)。
 * 4. 演示如何直接通过 envFilePath 初始化 EvmDataClient，以及如何通过纯代码配置对象初始化。
 * 5. 客户端生命周期管理 (initialize, close)。
 *
 * 运行方式:
 *   node examples/01_env_and_client_init.ts
 */

import { EnvLoader, EvmDataClient } from "../dist/index.js";
import { getEnvKeyPath, printHeader, printSection } from "./common.ts";

async function main() {
  printHeader("示例 01: 环境变量加载与客户端初始化 (EnvLoader & Client Init)");

  const envKeyPath = getEnvKeyPath();
  console.log(`正在读取配置文件: ${envKeyPath}`);

  // ===========================================================================
  // 1. 使用 EnvLoader 独立解析配置文件
  // ===========================================================================
  printSection("1. 使用 EnvLoader 检查与解析配置");
  const envLoader = new EnvLoader({ filePath: envKeyPath });

  // 1.1 解析多链 Archive RPC 节点
  const chains = ["ethereum", "base", "bsc", "polygon", "arbitrum", "optimism"] as const;
  console.log("🌐 已解析的多链 Archive RPC 节点池:");
  for (const chain of chains) {
    const endpoints = envLoader.getRpcEndpoints(chain);
    console.log(` - ${chain.padEnd(10)}: ${endpoints.length} 个节点`, endpoints.map((e) => e.id));
  }

  // 1.2 解析索引服务商配置与 Key 池
  const providers = envLoader.getProviderConfigs();
  console.log("\n🔑 已解析的数据索引服务商 (Etherscan / Blockscout / Alchemy / Moralis):");
  if (providers.length === 0) {
    console.log("   (未配置任何索引商 API Key，可在 .env.key 中配置 ETHERSCAN_API_KEY1 等)");
  } else {
    for (const p of providers) {
      console.log(` - 服务商: ${p.kind.padEnd(12)} (Key 池容量: ${p.apiKeys.length})`);
    }
  }

  // ===========================================================================
  // 2. 方式 A: 直接使用 envFilePath 初始化 EvmDataClient (推荐)
  // ===========================================================================
  printSection("2. 方式 A: 通过 envFilePath 快速初始化 EvmDataClient");
  const clientA = new EvmDataClient({
    envFilePath: envKeyPath,
    // 启用 Chainlink 链上预言机模块
    chainlink: { enabled: true },
    // 启用 DeFi 汇率模块 (Compound, Aave, Lido, Maker)
    defi: { enabled: true },
    // 启用 Uniswap V3 历史价格模块
    uniswapV3: { enabled: true },
    // 启用 Uniswap V4 历史价格模块
    uniswapV4: { enabled: true },
    // 配置代币现货价格聚合源 (Binance, OKX, Coinbase, GeckoTerminal)
    price: {
      providers: [
        { kind: "binance" },
        { kind: "okx" },
        { kind: "coinbase" },
        { kind: "geckoterminal" },
      ],
    },
    // 可选: 观测与遥测日志回调
    logger: (event) => {
      console.log(`   [Telemetry] op=${event.operation} provider=${event.provider} outcome=${event.outcome} duration=${event.durationMs}ms`);
    },
  });

  console.log("✅ clientA 初始化成功！已激活各子服务模块:");
  console.log(` - clientA.address   (地址与交易查询):   ${clientA.address ? "已就绪" : "未就绪"}`);
  console.log(` - clientA.token     (ERC20代币与价格):   ${clientA.token ? "已就绪" : "未就绪"}`);
  console.log(` - clientA.chain     (浏览器元数据):      ${clientA.chain ? "已就绪" : "未就绪"}`);
  console.log(` - clientA.rpc       (Archive RPC/Batch): ${clientA.rpc ? "已就绪" : "未启用"}`);
  console.log(` - clientA.chainlink (Chainlink预言机):   ${clientA.chainlink ? "已就绪" : "未启用"}`);
  console.log(` - clientA.defi      (DeFi协议汇率):      ${clientA.defi ? "已就绪" : "未启用"}`);
  console.log(` - clientA.uniswapV3 (Uniswap V3价格):    ${clientA.uniswapV3 ? "已就绪" : "未启用"}`);
  console.log(` - clientA.uniswapV4 (Uniswap V4价格):    ${clientA.uniswapV4 ? "已就绪" : "未启用"}`);
  console.log(` - clientA.sync      (数据同步入库):      ${clientA.sync ? "已就绪" : "未就绪"}`);
  console.log(` - clientA.history   (历史状态重放):      ${clientA.history ? "已就绪" : "未就绪"}`);

  // ===========================================================================
  // 3. 方式 B: 纯代码显式配置初始化 (适合从数据库或微服务配置中心读取)
  // ===========================================================================
  printSection("3. 方式 B: 纯代码显式配置初始化");
  const clientB = new EvmDataClient({
    providers: [
      {
        kind: "etherscan",
        apiKeys: ["dummy_etherscan_key"],
      },
    ],
    // 代理池配置 (支持纯 HTTP/HTTPS 代理)
    proxies: [
      // { url: "http://127.0.0.1:8080" }
    ],
    requestPolicy: {
      allowDirect: true,
      maxTotalAttempts: 3,
    },
    chainlink: { enabled: false },
    defi: { enabled: false },
  });
  console.log("✅ clientB 显式配置初始化成功！");

  // ===========================================================================
  // 4. 客户端生命周期 (initialize & close)
  // ===========================================================================
  printSection("4. 客户端生命周期调用");
  // initialize 会主动检测 RPC 节点健康状态并预热连接池、恢复冷却缓存
  console.log("正在执行 clientA.initialize()...");
  await clientA.initialize();
  console.log("✅ clientA.initialize() 完成");

  // 关闭客户端底层数据库与连接
  await clientA.close();
  await clientB.close();
  console.log("✅ 客户端连接已安全关闭 (client.close())");

  console.log("\n==================================================");
  console.log(" 🎉 示例 01 执行完毕！");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("❌ 示例运行失败:", err);
  process.exit(1);
});
