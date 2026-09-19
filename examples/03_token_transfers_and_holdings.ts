/**
 * 示例 03: ERC-20 代币转账与持仓查询 (TokenService: Transfers & Holdings)
 *
 * 功能说明:
 * 1. 分页查询地址的 ERC-20 代币转账事件 (getErc20Transfers)，支持过滤方向 (incoming/outgoing/both)。
 * 2. 区块范围代币转账扫描 (getErc20TransfersByBlockRange)，支持流式 onWindow 回调。
 * 3. 历史指定区块的特定代币余额查询 (getErc20BalancesAtBlock，基于索引 API，无需执行 RPC)。
 * 4. 钱包当前持有的全部代币发现 (getErc20TokenHoldings，依赖 Moralis 或 Alchemy)。
 * 5. 钱包在某一历史区块时刻的全部代币持仓发现 (getHoldingsAtBlock，依赖 Moralis)。
 *
 * 依赖说明:
 * - 需要在 .env.key 中配置 ETHERSCAN_API_KEY1 / ALCHEMY_API_KEY1 / MORALIS_API_KEY1。
 *
 * 运行方式:
 *   node examples/03_token_transfers_and_holdings.ts
 */

import { createExampleClient, printHeader, printSection, TEST_ADDRESSES } from "./common.ts";

async function main() {
  printHeader("示例 03: ERC-20 代币转账与持仓查询 (TokenService)");

  const client = createExampleClient();
  const address = TEST_ADDRESSES.VITALIK; // vitalik.eth
  const chain = "ethereum";

  console.log(`目标查询地址: ${address}`);
  console.log(`目标区块链:   ${chain}`);

  // ===========================================================================
  // 1. 分页拉取 ERC-20 代币转账事件 (getErc20Transfers)
  // ===========================================================================
  printSection("1. 分页查询 ERC-20 转账历史 (client.token.getErc20Transfers)");
  try {
    const transferPage = await client.token.getErc20Transfers({
      address,
      chain,
      direction: "incoming", // 仅查询入账转账 (可选: incoming | outgoing | both)
      pageSize: 4,
    });

    console.log(`✅ 成功获取入账 ERC-20 转账 (返回 ${transferPage.items.length} 条):`);
    console.log(`   - 数据来源: ${transferPage.pageInfo.provider}`);
    console.log(`   - 是否有下一页: ${transferPage.nextCursor !== null ? "是" : "否"}`);

    transferPage.items.forEach((t, i) => {
      console.log(`   [${i + 1}] 代币: ${t.tokenSymbol ?? "未知"} (${t.tokenAddress})`);
      console.log(`       数量: ${t.amount} (原始整数) | 精度: ${t.tokenDecimals ?? 18}`);
      console.log(`       发送方: ${t.from} -> 接收方: ${t.to}`);
      console.log(`       交易哈希: ${t.transactionHash} | 区块: ${t.blockNumber}`);
    });
  } catch (err: any) {
    console.warn("⚠️ ERC-20 转账查询提示:", err.message);
  }

  // ===========================================================================
  // 2. 闭区间区块范围代币转账扫描 (getErc20TransfersByBlockRange)
  // ===========================================================================
  printSection("2. 区块范围代币转账扫描 (client.token.getErc20TransfersByBlockRange)");
  try {
    const startBlock = "18000000";
    const endBlock = "18000050";
    console.log(`正在扫描区间 [${startBlock}, ${endBlock}] 内的 ERC-20 转账...`);

    const rangeResult = await client.token.getErc20TransfersByBlockRange({
      address,
      chain,
      startBlock,
      endBlock,
      direction: "both",
      onWindow: async (window) => {
        console.log(`   📦 [onWindow 批次] 区块 ${window.range.startBlock} ~ ${window.range.endBlock}, 转账数: ${window.items.length}`);
      },
    });

    console.log(`✅ 区块范围扫描完成! 共计获取转账: ${rangeResult.items.length} 条`);
    console.log(`   - 固定数据源: ${rangeResult.provider}`);
  } catch (err: any) {
    console.warn("⚠️ 区块范围扫描提示:", err.message);
  }

  // ===========================================================================
  // 3. 历史指定区块的特定代币余额 (getErc20BalancesAtBlock)
  // ===========================================================================
  printSection("3. 历史区块特定代币余额 (client.token.getErc20BalancesAtBlock)");
  try {
    // 查询在区块 19000000 时，Vitalik 地址上的 USDC 与 DAI 余额
    const historicalBlock = "19000000";
    const tokenBalances = await client.token.getErc20BalancesAtBlock({
      address,
      chain,
      blockNumber: historicalBlock,
      tokenAddresses: [
        TEST_ADDRESSES.USDC_ETHEREUM,
        TEST_ADDRESSES.DAI_ETHEREUM,
      ],
    });

    console.log(`✅ 成功获取区块 #${historicalBlock} 的代币余额快照:`);
    tokenBalances.tokens.forEach((token) => {
      console.log(`   - 代币 ${token.tokenAddress}: 余额 = ${token.balance}`);
    });
  } catch (err: any) {
    console.warn("⚠️ 历史代币余额查询提示:", err.message);
  }

  // ===========================================================================
  // 4. 当前钱包全部代币持仓发现 (getErc20TokenHoldings - Moralis / Alchemy)
  // ===========================================================================
  printSection("4. 钱包当前全部代币持仓发现 (client.token.getErc20TokenHoldings)");
  try {
    const holdings = await client.token.getErc20TokenHoldings({
      address,
      chain,
    });
    console.log(`✅ 成功发现当前持有 ${holdings.tokens.length} 种代币:`);
    holdings.tokens.slice(0, 5).forEach((h, i) => {
      console.log(`   [${i + 1}] ${h.tokenSymbol ?? "未知"} (${h.tokenName}): 余额 = ${h.balance} (精度: ${h.tokenDecimals})`);
    });
    if (holdings.tokens.length > 5) {
      console.log(`   ... 还有 ${holdings.tokens.length - 5} 种代币`);
    }
  } catch (err: any) {
    console.warn("⚠️ 代币持仓发现提示:", err.message);
    console.log("   (提示: 此功能需要配置 MORALIS_API_KEY1 或 ALCHEMY_API_KEY1)");
  }

  // ===========================================================================
  // 5. 钱包在历史某一区块的持仓发现 (getHoldingsAtBlock - Moralis)
  // ===========================================================================
  printSection("5. 历史指定区块全量持仓发现 (client.token.getHoldingsAtBlock)");
  try {
    const historicalBlock = "18500000";
    const snapshotHoldings = await client.token.getHoldingsAtBlock({
      address,
      chain,
      blockNumber: historicalBlock,
    });
    console.log(`✅ 成功发现区块 #${historicalBlock} 时的持有代币: ${snapshotHoldings.tokens.length} 种`);
  } catch (err: any) {
    console.warn("⚠️ 历史全量持仓发现提示:", err.message);
    console.log("   (提示: 此功能目前专属于 Moralis API，需配置 MORALIS_API_KEY1)");
  }

  await client.close();
  console.log("\n==================================================");
  console.log(" 🎉 示例 03 执行完毕！");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("❌ 示例运行失败:", err);
  process.exit(1);
});
