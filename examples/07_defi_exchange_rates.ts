/**
 * 示例 07: DeFi 收益与质押代币汇率 (DeFiExchangeRateService: Protocol Exchange Rates)
 *
 * 功能说明:
 * 1. 在历史精确区块高度，批量读取 DeFi 收益代币与质押代币的真实底层资产兑换率 (getExchangeRateSnapshot):
 *    - Compound: cToken (cUSDC, cDAI, cETH) 兑换底层资产汇率 (`exchangeRateStored`)
 *    - Aave V2/V3: aToken 储备借贷指数 (`liquidityIndex`)
 *    - Lido: wstETH 兑换 stETH 汇率 (`stEthPerToken`)
 *    - Maker / Sky: sDAI 存款利率转换 (`chi` / pot)
 * 2. 支持多链: Ethereum 主网与 Base 主网。
 *
 * 依赖说明:
 * - 需要启用 defi: { enabled: true }。
 * - 使用对应链的 Archive RPC 节点。
 *
 * 运行方式:
 *   node examples/07_defi_exchange_rates.ts
 */

import { createExampleClient, printHeader, printSection } from "./common.ts";

async function main() {
  printHeader("示例 07: DeFi 收益与质押代币汇率 (DeFiExchangeRateService)");

  const client = createExampleClient({
    defi: { enabled: true },
  });

  if (!client.defi) {
    console.error("❌ DeFi 模块未启用");
    return;
  }

  // ===========================================================================
  // 1. 获取 Ethereum 主网 DeFi 资产汇率快照 (getExchangeRatesAtBlock)
  // ===========================================================================
  printSection("1. Ethereum 主网 DeFi 代币底层兑换率");
  try {
    const historicalBlock = "19000000";
    console.log(`正在读取 Ethereum 区块 #${historicalBlock} 的 DeFi 兑换率快照...`);

    const snapshot = await client.defi.getExchangeRatesAtBlock({
      chain: "ethereum",
      blockNumber: historicalBlock,
    });

    console.log("✅ DeFi 汇率快照读取成功:");
    console.log(`   - 区块高度:       #${snapshot.blockNumber}`);
    console.log(`   - 链 ID:          ${snapshot.chainId}`);
    console.log(`   - 使用的 RPC 节点: ${snapshot.rpcEndpointId}`);
    console.log(`   - 成功解析代币:   ${snapshot.summary.succeededTokens} 个`);
    console.log(`   - 失败/未部署:    ${snapshot.summary.failedTokens} 个`);

    console.log("\n📈 常见 DeFi 资产底层兑换率 (展示前 6 个):");
    snapshot.rates.slice(0, 6).forEach((r, idx) => {
      const underlyingInfo = r.underlyings.map((u) => `${u.amount} ${u.underlyingSymbol}`).join(", ");
      console.log(`   [${idx + 1}] ${r.tokenSymbol.padEnd(8)} (协议: ${r.protocol.padEnd(10)}) -> 底层兑换: ${underlyingInfo}`);
    });
  } catch (err: any) {
    console.warn("⚠️ DeFi 汇率查询提示:", err.message);
    console.log("   (提示: 请确保配置了可用的 Ethereum Archive RPC 节点)");
  }

  // ===========================================================================
  // 2. 指定特定代币查询 (如仅查询 wstETH)
  // ===========================================================================
  printSection("2. 过滤指定 DeFi 代币查询 (例如 wstETH)");
  try {
    const historicalBlock = "19500000";
    const wstethSnapshot = await client.defi.getExchangeRatesAtBlock({
      chain: "ethereum",
      blockNumber: historicalBlock,
      tokenIds: ["ethereum:lido:wsteth"],
    });

    const rate = wstethSnapshot.rates[0];
    if (rate && rate.underlyings[0]) {
      console.log(`✅ wstETH 汇率 (区块 #${historicalBlock}):`);
      console.log(`   1 wstETH = ${rate.underlyings[0].amount} ${rate.underlyings[0].symbol}`);
    }
  } catch (err: any) {
    console.warn("⚠️ 指定代币查询提示:", err.message);
  }

  await client.close();
  console.log("\n==================================================");
  console.log(" 🎉 示例 07 执行完毕！");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("❌ 示例运行失败:", err);
  process.exit(1);
});
