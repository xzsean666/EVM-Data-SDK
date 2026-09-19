/**
 * 示例 08: Uniswap V3 & V4 历史池子价格 (Uniswap Historical Pool Prices)
 *
 * 功能说明:
 * 1. Uniswap V3 历史池子状态与价格计算 (client.uniswapV3.getHistoricalPrice):
 *    - 在指定历史区块，通过 Multicall3 读取流动性池的 slot0 数据 (sqrtPriceX96 与 tick)。
 *    - 基于 Q64.96 定点数算法与 tick 幂次计算精确现货价格 (spot price) 与 tick 价格。
 *    - 自动识别代币精度并计算 USD/标价资产汇率。
 * 2. Uniswap V4 历史池子状态与价格计算 (client.uniswapV4.getHistoricalPrice):
 *    - 通过 Uniswap V4 的 StateView 合约读取 getSlot0。
 *
 * 依赖说明:
 * - 需要启用 uniswapV3: { enabled: true } 或 uniswapV4: { enabled: true }。
 * - 使用 Ethereum Archive RPC 节点。
 *
 * 运行方式:
 *   node examples/08_uniswap_historical_prices.ts
 */

import { createExampleClient, printHeader, printSection } from "./common.ts";

async function main() {
  printHeader("示例 08: Uniswap V3 & V4 历史池子价格 (Uniswap Services)");

  const client = createExampleClient({
    uniswapV3: { enabled: true },
    uniswapV4: { enabled: true },
  });

  // ===========================================================================
  // 1. Uniswap V3 历史池子价格读取 (client.uniswapV3.getTokenPricesAtBlock)
  // ===========================================================================
  printSection("1. Uniswap V3 历史池子价格 (client.uniswapV3.getTokenPricesAtBlock)");
  if (client.uniswapV3) {
    try {
      const historicalBlock = "19000000";
      console.log(`正在读取 Ethereum 区块 #${historicalBlock} 的 Uniswap V3 核心池价格...`);

      const v3Result = await client.uniswapV3.getTokenPricesAtBlock({
        chain: "ethereum",
        blockNumber: historicalBlock,
      });

      console.log("✅ Uniswap V3 历史价格读取成功:");
      console.log(`   - 区块高度:       #${v3Result.blockNumber}`);
      console.log(`   - 使用的 RPC 节点: ${v3Result.rpcEndpointId}`);
      console.log(`   - 成功解析池子数: ${v3Result.summary.succeededTokens} 个`);

      console.log("\n📊 核心交易对价格 (展示前 6 个):");
      v3Result.prices.slice(0, 6).forEach((p, idx) => {
        console.log(`   [${idx + 1}] ${p.tokenSymbol.padEnd(8)} (池子: ${p.poolAddress.slice(0, 10)}... 手续费: ${p.feeTier / 10000}%)`);
        console.log(`       现货价格: ${p.price} ${p.quoteToken.symbol} | Tick 价格: ${p.tickPrice} ${p.quoteToken.symbol}`);
      });
    } catch (err: any) {
      console.warn("⚠️ Uniswap V3 查询提示:", err.message);
      console.log("   (提示: 请确保配置了可用的 Ethereum Archive RPC 节点)");
    }
  } else {
    console.log("   (未启用 uniswapV3 模块)");
  }

  // ===========================================================================
  // 2. Uniswap V4 历史池子价格读取 (client.uniswapV4.getTokenPricesAtBlock)
  // ===========================================================================
  printSection("2. Uniswap V4 历史池子价格 (client.uniswapV4.getTokenPricesAtBlock)");
  if (client.uniswapV4) {
    try {
      // Uniswap V4 主网部署较晚，选择一个较新的区块
      const v4Block = "21000000";
      console.log(`正在读取区块 #${v4Block} 的 Uniswap V4 池子价格 (StateView)...`);

      const v4Result = await client.uniswapV4.getTokenPricesAtBlock({
        chain: "ethereum",
        blockNumber: v4Block,
      });

      console.log(`✅ Uniswap V4 历史价格读取成功: 解析 ${v4Result.prices.length} 个池子`);
      v4Result.prices.forEach((p, idx) => {
        console.log(`   [${idx + 1}] ${p.tokenSymbol} -> ${p.quoteCurrency.symbol}: 价格 = ${p.price}`);
      });
    } catch (err: any) {
      console.warn("⚠️ Uniswap V4 查询提示:", err.message);
    }
  } else {
    console.log("   (未启用 uniswapV4 模块)");
  }

  await client.close();
  console.log("\n==================================================");
  console.log(" 🎉 示例 08 执行完毕！");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("❌ 示例运行失败:", err);
  process.exit(1);
});
