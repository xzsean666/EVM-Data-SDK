/**
 * 示例 04: 代币聚合价格与 K 线数据 (Token Price Aggregation & K-Lines)
 *
 * 功能说明:
 * 1. 多源代币现货价格聚合与清洗 (getPriceHistory):
 *    - 汇总 Binance, OKX, Coinbase, GeckoTerminal 等公开行情源。
 *    - 自动剔除离群值 (outliers) 并计算中位数价格，确保价格可靠。
 *    - 支持按代币符号 (如 "ETH", "BTC") 或合约地址查询。
 * 2. 币安高精度 K 线行情抓取 (getBinanceKlines):
 *    - 支持 5m、15m、1h、1d 等粒度的 OHLCV 蜡烛图 K 线。
 * 3. Gate.io 现货 K 线行情抓取 (getGateKlinesPrices):
 *    - 多节点自动轮询抓取历史时间序列价格点。
 *
 * 依赖说明:
 * - 价格行情接口均为公共接口，不需要 API Key，但需要能够访问对应交易所的网络连接 (可配置 HTTP_PROXY)。
 *
 * 运行方式:
 *   node examples/04_token_prices_and_klines.ts
 */

import { createExampleClient, printHeader, printSection } from "./common.ts";

async function main() {
  printHeader("示例 04: 代币聚合价格与 K 线数据 (Price Aggregation & K-Lines)");

  const client = createExampleClient();

  // ===========================================================================
  // 1. 多源现货价格聚合查询 (getPriceHistory)
  // ===========================================================================
  printSection("1. 多源代币现货价格聚合 (client.token.getPriceHistory)");
  try {
    console.log("正在从 Binance/OKX/Coinbase/GeckoTerminal 聚合 ETH 价格...");
    const ethPrice = await client.token.getPriceHistory({
      token: "ETH",
      range: { kind: "latest", days: 1 },
    });

    const firstResult = ethPrice.results[0];
    const latestPoint = firstResult?.points[firstResult.points.length - 1];
    console.log("✅ ETH 聚合价格获取成功:");
    console.log(`   - 成功服务商数: ${ethPrice.summary.succeededProviders} / ${ethPrice.summary.requestedProviders}`);
    if (firstResult && latestPoint) {
      console.log(`   - 来源服务商:   ${firstResult.provider}`);
      console.log(`   - 最新收盘价:   $${latestPoint.close}`);
      console.log(`   - 价格时间:     ${latestPoint.date}`);
      console.log(`   - 采集点数:     ${firstResult.points.length}`);
    }

    // 查看 BTC 价格
    console.log("\n正在聚合 BTC 价格...");
    const btcPrice = await client.token.getPriceHistory({
      token: "BTC",
      range: { kind: "latest", days: 1 },
    });
    const btcResult = btcPrice.results[0];
    const btcLatest = btcResult?.points[btcResult.points.length - 1];
    console.log(`✅ BTC 最新价格: $${btcLatest?.close ?? "N/A"} (来源: ${btcResult?.provider ?? "N/A"})`);
  } catch (err: any) {
    console.warn("⚠️ 价格聚合查询提示:", err.message);
    console.log("   (提示: 若遇到网络超时或连接重置，请在 .env.key 中配置 HTTP_PROXY 代理)");
  }

  // ===========================================================================
  // 2. Binance K 线行情数据 (client.getBinanceKlines)
  // ===========================================================================
  printSection("2. Binance K 线行情抓取 (client.getBinanceKlines)");
  try {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    console.log("正在请求 Binance ETH 最近 1 小时的 5 分钟 K 线...");
    const klines = await client.getBinanceKlines({
      token: "ETH",
      start: oneHourAgo,
      end: now,
      interval: "5m", // 5m 粒度
    });

    console.log(`✅ 成功获取 ${klines.points.length} 根 K 线:`);
    klines.points.slice(0, 5).forEach((k, idx) => {
      console.log(`   [${idx + 1}] 时间: ${new Date(k.timestamp).toISOString()} | 价格: $${k.priceUsd}`);
    });
  } catch (err: any) {
    console.warn("⚠️ Binance K 线抓取提示:", err.message);
  }

  // ===========================================================================
  // 3. Gate.io 现货 K 线行情 (client.token.getGateKlinesPrices)
  // ===========================================================================
  printSection("3. Gate.io 现货 K 线抓取 (client.token.getGateKlinesPrices)");
  try {
    const now = Date.now();
    const twoHoursAgo = now - 2 * 60 * 60 * 1000;

    console.log("正在请求 Gate.io ETH_USDT K 线价格点...");
    const gatePoints = await client.token.getGateKlinesPrices({
      pair: "ETH_USDT",
      interval: "5m",
      start: twoHoursAgo,
      end: now,
    });

    console.log(`✅ 成功获取 Gate.io 价格点: ${gatePoints.length} 个`);
    gatePoints.slice(0, 3).forEach((p, idx) => {
      console.log(`   [${idx + 1}] 时间: ${new Date(p.timestamp).toISOString()} | 价格: $${p.priceUsd}`);
    });
  } catch (err: any) {
    console.warn("⚠️ Gate.io K 线抓取提示:", err.message);
  }

  await client.close();
  console.log("\n==================================================");
  console.log(" 🎉 示例 04 执行完毕！");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("❌ 示例运行失败:", err);
  process.exit(1);
});
