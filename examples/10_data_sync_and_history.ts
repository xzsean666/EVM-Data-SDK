/**
 * 示例 10: 数据同步入库与历史状态重放 (SyncService, HistoryService & PriceSync)
 *
 * 功能说明:
 * 1. 增量数据同步与防分叉入库 (client.sync.update):
 *    - 自动管理同步游标 (nextBlock, targetBlock)。
 *    - 自动应用分叉重叠回滚保护 (reorg overlap blocks)。
 *    - 支持 transactions (普通交易), erc20 (代币转账), internal_native (内部交易)。
 * 2. 同步状态查询 (client.sync.getStatus):
 *    - 实时查看某地址在某数据集上的同步水位线。
 * 3. 历史账本重放与状态重建 (client.history.getUserStateAtBlock):
 *    - 根据本地数据库已同步的事实事件，重构用户在任意历史区块的原生代币与 ERC-20 余额及流水。
 * 4. 本地代币流水查询 (client.history.getTokenFlowHistory):
 *    - 高性能按区块与游标检索本地已持久化的代币进出流水。
 * 5. 行情价格同步 (client.price.update & getSyncStatus):
 *    - 增量同步交易所 K 线行情并持久化到本地 SQLite / PostgreSQL。
 *
 * 依赖说明:
 * - 默认使用 SQLite 本地文件数据库 (可在 .env.key 中配置 DATABASE_URL=sqlite:./data/evm-data.db 或 postgres://...)。
 *
 * 运行方式:
 *   node examples/10_data_sync_and_history.ts
 */

import { createExampleClient, printHeader, printSection, TEST_ADDRESSES } from "./common.ts";

async function main() {
  printHeader("示例 10: 数据同步入库与历史状态重放 (Sync & History Services)");

  const client = createExampleClient();
  await client.initialize();

  const chain = "ethereum";
  const address = TEST_ADDRESSES.VITALIK;

  // ===========================================================================
  // 1. 查询当前同步状态 (client.sync.getStatus)
  // ===========================================================================
  printSection("1. 查看地址同步状态 (client.sync.getStatus)");
  try {
    const status = await client.sync.getStatus({
      chain,
      address,
      dataset: "erc20",
    });

    console.log("✅ 当前同步状态:");
    console.log(`   - 作用域键:     ${status.scopeKey}`);
    console.log(`   - 数据集类型:   ${status.dataset}`);
    console.log(`   - 当前状态:     ${status.status}`);
    console.log(`   - 下一区块:     ${status.nextBlock ?? "尚未开始"}`);
    console.log(`   - 目标区块:     ${status.targetBlock ?? "无"}`);
    console.log(`   - 最近更新时间: ${status.updatedAt ?? "N/A"}`);
  } catch (err: any) {
    console.warn("⚠️ 获取同步状态提示:", err.message);
  }

  // ===========================================================================
  // 2. 执行一次增量同步 (client.sync.update)
  // ===========================================================================
  printSection("2. 执行增量数据同步 (client.sync.update)");
  try {
    // 同步一个小区间以演示入库逻辑
    const fromBlock = "18000000";
    const toBlock = "18000020";
    console.log(`正在同步地址 ${address} 的 ERC-20 转账数据 (区块 ${fromBlock} ~ ${toBlock})...`);

    const syncResult = await client.sync.update({
      chain,
      address,
      dataset: "erc20",
      fromBlock,
      toBlock,
    });

    console.log("✅ 同步执行完成:");
    console.log(`   - 任务状态:     ${syncResult.status}`);
    console.log(`   - 已扫描区间:   ${syncResult.fromBlock} ~ ${syncResult.toBlock}`);
    console.log(`   - 写入记录数:   ${syncResult.recordsWritten}`);
    console.log(`   - 重复跳过数:   ${syncResult.duplicates}`);
    console.log(`   - 下一同步起始: 区块 #${syncResult.nextBlock}`);
  } catch (err: any) {
    console.warn("⚠️ 增量同步提示:", err.message);
  }

  // ===========================================================================
  // 3. 从本地数据库查询代币流水历史 (client.history.getTokenFlowHistory)
  // ===========================================================================
  printSection("3. 查询本地持久化的代币流水 (client.history.getTokenFlowHistory)");
  try {
    const flowHistory = await client.history.getTokenFlowHistory({
      chain,
      address,
      startBlock: "18000000",
      endBlock: "18000050",
      limit: 5,
    });

    console.log(`✅ 本地代币流水查询成功 (命中 ${flowHistory.length} 条记录):`);
    flowHistory.forEach((item, idx) => {
      console.log(`   [${idx + 1}] 代币: ${item.tokenAddress} | 金额: ${item.amount}`);
      console.log(`       方向: ${item.direction} | 区块: ${item.blockNumber} | 交易: ${item.transactionHash}`);
    });
  } catch (err: any) {
    console.warn("⚠️ 本地流水查询提示:", err.message);
  }

  // ===========================================================================
  // 4. 重建指定历史区块的用户状态快照 (client.history.getUserStateAtBlock)
  // ===========================================================================
  printSection("4. 重建历史区块用户状态 (client.history.getUserStateAtBlock)");
  try {
    const targetBlock = "18000020";
    console.log(`正在基于已入库事实计算区块 #${targetBlock} 的用户余额状态...`);

    const userState = await client.history.getUserStateAtBlock({
      chain,
      address,
      blockNumber: targetBlock,
    });

    console.log("✅ 历史状态重建成功:");
    console.log(`   - 状态就绪:     ${userState.state}`);
    console.log(`   - 原生币余额:   ${userState.nativeBalance} wei`);
    console.log(`   - 累计交易笔数: ${userState.transactionCount}`);
    console.log(`   - 代币资产种类: ${userState.balances.length} 种`);
    userState.balances.slice(0, 3).forEach((b) => {
      console.log(`     * 代币 ${b.tokenAddress}: 余额 = ${b.amount}`);
    });
  } catch (err: any) {
    console.warn("⚠️ 历史状态重建提示:", err.message);
  }

  await client.close();
  console.log("\n==================================================");
  console.log(" 🎉 示例 10 执行完毕！");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("❌ 示例运行失败:", err);
  process.exit(1);
});
