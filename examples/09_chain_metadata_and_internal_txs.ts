/**
 * 示例 09: 区块浏览器元数据与内部交易 (ApiChainService: Metadata & Traces)
 *
 * 功能说明:
 * 1. 浏览器索引 API 区块与时间戳定位:
 *    - getLatestBlockNumber: 通过 Etherscan/Blockscout 获取最新区块高度。
 *    - getBlockNumberByTimestamp: 根据时间戳定位区块。
 * 2. 交易详情与收据批量查询 (getTransactionContextsByHash):
 *    - 获取交易的 Receipt (gasUsed, status, logs) 与完整执行上下文。
 * 3. 内部交易 (Internal Transactions / Traces) 区块范围扫描:
 *    - getInternalNativeTransfersByBlockRange: 捕获合约执行触发的原生币内部转账 (如合约提款、跨合约调用)。
 * 4. 以太坊 PoS 信标链提款扫描 (getBeaconWithdrawalsByBlockRange):
 *    - 扫描以太坊 2.0 验证者提款事件 (Beacon Withdrawals)。
 *
 * 依赖说明:
 * - 需要在 .env.key 中配置 ETHERSCAN_API_KEY1 或 BLOCKSCOUT_API_KEY1。
 *
 * 运行方式:
 *   node examples/09_chain_metadata_and_internal_txs.ts
 */

import { createExampleClient, printHeader, printSection, TEST_ADDRESSES } from "./common.ts";

async function main() {
  printHeader("示例 09: 区块浏览器元数据与内部交易 (ApiChainService)");

  const client = createExampleClient();
  const chain = "ethereum";
  const address = TEST_ADDRESSES.VITALIK;

  // ===========================================================================
  // 1. 通过浏览器 API 获取最新区块与时间戳定位
  // ===========================================================================
  printSection("1. 浏览器 API 区块高度查询 (client.chain.getLatestBlockNumber)");
  try {
    const latest = await client.chain.getLatestBlockNumber({ chain });
    console.log(`✅ 浏览器返回最新区块: #${latest.blockNumber} (服务商: ${latest.provider})`);

    const ts = String(Math.floor(new Date("2024-06-01T00:00:00Z").getTime() / 1000));
    const blockForTs = await client.chain.getBlockNumberByTimestamp({
      chain,
      timestamp: ts,
    });
    console.log(`✅ 时间戳 ${ts} 对应区块: #${blockForTs.blockNumber} (服务商: ${blockForTs.provider})`);
  } catch (err: any) {
    console.warn("⚠️ 浏览器区块查询提示:", err.message);
  }

  // ===========================================================================
  // 2. 批量查询交易执行详情与收据 (client.chain.getTransactionContextsByHash)
  // ===========================================================================
  printSection("2. 交易详情与收据查询 (client.chain.getTransactionContextsByHash)");
  try {
    // Vitalik 著名的某一笔转账交易哈希
    const sampleTxHash = "0x5c504ed432cb51138bcf09aa5e8a410dd4a1e204ef84bfed1be16dfba1b22060";
    console.log(`正在获取交易 ${sampleTxHash} 的执行上下文与收据...`);

    const contextResult = await client.chain.getTransactionContextsByHash({
      chain,
      hashes: [sampleTxHash],
    });

    const txContext = contextResult.contexts[0];
    if (txContext) {
      console.log("✅ 交易上下文获取成功:");
      console.log(`   - 交易哈希:     ${txContext.transaction.hash}`);
      console.log(`   - 发送方:       ${txContext.transaction.from}`);
      console.log(`   - 接收方:       ${txContext.transaction.to}`);
      console.log(`   - 交易金额:     ${txContext.transaction.value} wei`);
      console.log(`   - 执行状态:     ${txContext.receipt?.status === "1" ? "成功 (Success)" : "失败"}`);
      console.log(`   - Gas 消耗:     ${txContext.receipt?.gasUsed}`);
      console.log(`   - 产生的 Logs:  ${txContext.receipt?.logs.length ?? 0} 条`);
    }
  } catch (err: any) {
    console.warn("⚠️ 交易上下文查询提示:", err.message);
  }

  // ===========================================================================
  // 3. 内部交易 (Internal Traces) 区块范围扫描
  // ===========================================================================
  printSection("3. 内部转账扫描 (client.chain.getInternalNativeTransfersByBlockRange)");
  try {
    const startBlock = "18000000";
    const endBlock = "18000050";
    console.log(`正在扫描区间 [${startBlock}, ${endBlock}] 内的内部转账 (地址: ${address})...`);

    const internalTxs = await client.chain.getInternalNativeTransfersByBlockRange({
      chain,
      address,
      startBlock,
      endBlock,
    });

    console.log(`✅ 内部转账扫描完成! 共命中: ${internalTxs.items.length} 笔内部转账`);
    internalTxs.items.forEach((itx, i) => {
      console.log(`   [${i + 1}] 主交易哈希: ${itx.transactionHash}`);
      console.log(`       From: ${itx.from} -> To: ${itx.to} | 金额: ${itx.value} wei`);
    });
  } catch (err: any) {
    console.warn("⚠️ 内部转账查询提示:", err.message);
  }

  // ===========================================================================
  // 4. 信标链 PoS 验证者提款扫描 (getBeaconWithdrawalsByBlockRange)
  // ===========================================================================
  printSection("4. 信标链验证者提款扫描 (client.chain.getBeaconWithdrawalsByBlockRange)");
  try {
    const startBlock = "19000000";
    const endBlock = "19000010";
    console.log(`正在扫描区间 [${startBlock}, ${endBlock}] 内的信标链提款...`);

    const withdrawals = await client.chain.getBeaconWithdrawalsByBlockRange({
      chain,
      startBlock,
      endBlock,
    });

    console.log(`✅ 信标链提款扫描完成! 共命中: ${withdrawals.items.length} 条提款记录`);
    withdrawals.items.slice(0, 3).forEach((w, i) => {
      console.log(`   [${i + 1}] 验证者 Index: ${w.validatorIndex} -> 提款地址: ${w.address} | 金额: ${w.amount} gwei`);
    });
  } catch (err: any) {
    console.warn("⚠️ 信标链提款查询提示:", err.message);
  }

  await client.close();
  console.log("\n==================================================");
  console.log(" 🎉 示例 09 执行完毕！");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("❌ 示例运行失败:", err);
  process.exit(1);
});
