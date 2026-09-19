/**
 * 示例 06: Chainlink 链上预言机历史价格 (ChainlinkService: On-chain Price Feeds)
 *
 * 功能说明:
 * 1. 在历史精确区块高度，批量读取 Ethereum 主网所有内置 Chainlink 价格预言机喂价 (getTokenPricesAtBlock)。
 * 2. 基于 Multicall3 高性能聚合调用：
 *    - 读取 latestRoundData() 与 decimals()。
 *    - 自动格式化定点小数，输出标准人类可读十进制价格。
 * 3. 容错设计：
 *    - 若个别喂价在目标区块未部署或调用 revert，会记录在 failures 中，不影响其他预言机正常解析。
 *
 * 依赖说明:
 * - 需要启用 chainlink: { enabled: true }。
 * - 使用 Ethereum Archive RPC 节点。
 *
 * 运行方式:
 *   node examples/06_chainlink_oracles.ts
 */

import { createExampleClient, printHeader, printSection } from "./common.ts";

async function main() {
  printHeader("示例 06: Chainlink 链上预言机历史价格 (ChainlinkService)");

  const client = createExampleClient({
    chainlink: { enabled: true },
  });

  if (!client.chainlink) {
    console.error("❌ Chainlink 模块未启用");
    return;
  }

  // ===========================================================================
  // 1. 获取某一历史区块的全量 Chainlink 喂价 (getTokenPricesAtBlock)
  // ===========================================================================
  printSection("1. 历史区块 Chainlink 价格查询 (client.chainlink.getTokenPricesAtBlock)");
  try {
    const historicalBlock = "19000000";
    console.log(`正在读取区块 #${historicalBlock} 的 Chainlink 预言机喂价...`);

    const result = await client.chainlink.getTokenPricesAtBlock({
      blockNumber: historicalBlock,
    });

    console.log("✅ Chainlink 链上预言机读取成功:");
    console.log(`   - 区块高度:       #${result.blockNumber}`);
    console.log(`   - 区块时间戳:     ${new Date(Number(result.blockTimestamp) * 1000).toISOString()}`);
    console.log(`   - 使用的 RPC 节点: ${result.rpcEndpointId}`);
    console.log(`   - 成功解析喂价数: ${result.summary.succeededFeeds} 个`);
    console.log(`   - 失败/未就绪数:  ${result.summary.failedFeeds} 个`);
    console.log(`   - Multicall 批次: ${result.summary.multicallBatches} 批`);

    console.log("\n📊 核心代币价格快照 (展示前 8 个):");
    result.prices.slice(0, 8).forEach((p, idx) => {
      console.log(`   [${idx + 1}] ${p.tokenSymbol.padEnd(8)} (喂价: ${p.feedId}): $${p.price}`);
    });

    if (result.failures.length > 0) {
      console.log(`\n⚠️ 在区块 #${historicalBlock} 未激活或 revert 的喂价示例:`);
      result.failures.slice(0, 3).forEach((f) => {
        console.log(`   - ${f.feedId}: 错误码=${f.code} 原因=${f.message}`);
      });
    }
  } catch (err: any) {
    console.warn("⚠️ Chainlink 查询提示:", err.message);
    console.log("   (提示: 请确保配置了可用的 Ethereum Archive RPC 节点)");
  }

  await client.close();
  console.log("\n==================================================");
  console.log(" 🎉 示例 06 执行完毕！");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("❌ 示例运行失败:", err);
  process.exit(1);
});
