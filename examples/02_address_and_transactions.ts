/**
 * 示例 02: 地址余额与普通交易查询 (AddressService: Native Balance & Transactions)
 *
 * 功能说明:
 * 1. 查询指定地址的原生币最新余额 (getNativeBalance: ETH / BNB / MATIC 等)。
 * 2. 分页拉取普通原生交易历史 (getTransactions)，支持指定 pageSize、order (asc/desc) 以及游标 cursor。
 * 3. 闭区间区块范围交易扫描 (getTransactionsByBlockRange)，支持 SDK 托管的游标分页与 onWindow 流式回调。
 *
 * 依赖说明:
 * - 需要在 .env.key 中配置至少一个支持该链的索引服务商 (如 ETHERSCAN_API_KEY1 / ALCHEMY_API_KEY1 / BLOCKSCOUT_API_KEY1)。
 *
 * 运行方式:
 *   node examples/02_address_and_transactions.ts
 */

import { createExampleClient, printHeader, printSection, TEST_ADDRESSES } from "./common.ts";

async function main() {
  printHeader("示例 02: 地址余额与普通交易查询 (AddressService)");

  const client = createExampleClient();
  const address = TEST_ADDRESSES.VITALIK; // vitalik.eth
  const chain = "ethereum";

  console.log(`目标查询地址: ${address}`);
  console.log(`目标区块链:   ${chain}`);

  // ===========================================================================
  // 1. 查询原生币余额 (getNativeBalance)
  // ===========================================================================
  printSection("1. 查询地址原生币最新余额 (client.address.getNativeBalance)");
  try {
    const balance = await client.address.getNativeBalance({
      address,
      chain,
    });
    const weiBigInt = BigInt(balance.amount);
    const ethValue = (Number(weiBigInt / 10n ** 14n) / 10000).toFixed(4);

    console.log("✅ 原生余额查询成功:");
    console.log(`   - 链 ID:   ${balance.chainId}`);
    console.log(`   - 地址:    ${balance.address}`);
    console.log(`   - Wei 数:  ${balance.amount}`);
    console.log(`   - ETH 估算: 约 ${ethValue} ETH`);
  } catch (err: any) {
    console.warn("⚠️ 原生余额查询提示:", err.message);
    console.log("   (提示: 请在 .env.key 中配置 ETHERSCAN_API_KEY1 或 ALCHEMY_API_KEY1)");
  }

  // ===========================================================================
  // 2. 分页查询普通原生交易历史 (getTransactions)
  // ===========================================================================
  printSection("2. 分页查询普通原生交易历史 (client.address.getTransactions)");
  try {
    const txPage = await client.address.getTransactions({
      address,
      chain,
      pageSize: 3, // 每页数量
      order: "desc", // 按区块倒序
    });

    console.log(`✅ 成功获取第 1 页交易 (返回 ${txPage.items.length} 条):`);
    console.log(`   - 数据来源服务商: ${txPage.pageInfo.provider}`);
    console.log(`   - 是否有下一页:   ${txPage.nextCursor !== null ? "是 (有 nextCursor)" : "否"}`);

    txPage.items.forEach((tx, idx) => {
      console.log(`   [${idx + 1}] 交易哈希: ${tx.hash}`);
      console.log(`       区块高度: ${tx.blockNumber} | 时间戳: ${tx.timestamp}`);
      console.log(`       发送方:   ${tx.from}`);
      console.log(`       接收方:   ${tx.to ?? "(合约创建)"}`);
      console.log(`       转账金额: ${tx.value} wei`);
    });

    // 如果有下一页，可以继续拉取
    if (txPage.nextCursor) {
      console.log(`\n   ↪ 尝试使用游标拉取第 2 页 (cursor: ${txPage.nextCursor.slice(0, 30)}...):`);
      const page2 = await client.address.getTransactions({
        address,
        chain,
        pageSize: 2,
        cursor: txPage.nextCursor,
      });
      console.log(`   ✅ 第 2 页成功拉取 ${page2.items.length} 条交易`);
    }
  } catch (err: any) {
    console.warn("⚠️ 交易查询提示:", err.message);
  }

  // ===========================================================================
  // 3. 区块范围交易扫描与流式回调 (getTransactionsByBlockRange)
  // ===========================================================================
  printSection("3. 区块范围扫描 (client.address.getTransactionsByBlockRange)");
  try {
    // 选定一个确定有交易的历史小区间进行演示
    const startBlock = "18000000";
    const endBlock = "18000100";
    console.log(`正在扫描区块范围: [${startBlock}, ${endBlock}]...`);

    const rangeResult = await client.address.getTransactionsByBlockRange({
      address,
      chain,
      startBlock,
      endBlock,
      order: "asc",
      // 流式回调: 每扫描完一个窗口或一页，实时交付数据
      onWindow: async (window) => {
        console.log(`   📦 [onWindow 收到批次] 区块 ${window.range.startBlock} ~ ${window.range.endBlock}, 命中交易数: ${window.items.length}`);
      },
    });

    console.log(`✅ 区块范围扫描完成! 共计获取交易: ${rangeResult.items.length} 条`);
    console.log(`   - 固定的数据源: ${rangeResult.provider}`);
    console.log(`   - 上游请求次数: ${rangeResult.upstreamRequests}`);
  } catch (err: any) {
    console.warn("⚠️ 区块范围扫描提示:", err.message);
  }

  await client.close();
  console.log("\n==================================================");
  console.log(" 🎉 示例 02 执行完毕！");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("❌ 示例运行失败:", err);
  process.exit(1);
});
