/**
 * 示例 05: 归档 RPC、Multicall3 与批量调用 (Archive RPC, Multicall3 & JSON-RPC Batch)
 *
 * 功能说明:
 * 1. 纯 RPC 二分查找区块高度与时间戳映射 (getLatestBlockNumber, getBlockNumberByTimestamp):
 *    - 不需要任何 Etherscan 等索引商 API Key，仅凭公共 Archive RPC 节点即可定位区块。
 * 2. 历史精确区块原生代币余额读取 (getNativeBalanceAtBlock):
 *    - 通过 Archive RPC eth_getBalance 在指定历史 blockNumber 精确读取。
 * 3. ERC-20 批量聚合读取 (client.token.getErc20MulticallAtBlock):
 *    - 在单个 Multicall3 中一次性批量读取代币 decimals, symbol, name, totalSupply, balanceOf。
 * 4. 底层任意合约 Multicall3 调用 (client.rpc.multicallAtBlock):
 *    - SDK 自动处理分批、失败容忍 (allowFailure) 以及前后 blockHash 一致性校验。
 * 5. 通用 JSON-RPC Batch 批量调用 (client.rpc.batch):
 *    - 自动分块、并发控制和节点轮询，执行任意标准 JSON-RPC 批处理调用。
 *
 * 依赖说明:
 * - 需要启用 chainlink/defi/uniswapV3 中任意一个或配置 RPC 节点 (如 ALCHEMY_RPC_API_KEY1 / NODEREAL_RPC_API_KEY1 等)。
 *
 * 运行方式:
 *   node examples/05_archive_rpc_multicall.ts
 */

import { createExampleClient, printHeader, printSection, TEST_ADDRESSES } from "./common.ts";

async function main() {
  printHeader("示例 05: 归档 RPC、Multicall3 与批量调用 (Archive RPC & Multicall3)");

  const client = createExampleClient({
    chainlink: { enabled: true },
    defi: { enabled: true },
  });

  const chain = "ethereum";
  const address = TEST_ADDRESSES.VITALIK;

  // ===========================================================================
  // 1. 纯 RPC 查找最新区块与时间戳二分定位 (无需 Etherscan Key)
  // ===========================================================================
  printSection("1. 纯 Archive RPC 区块查询 (无需 API Key)");
  try {
    console.log("正在通过 Archive RPC 查询 Ethereum 最新区块高度...");
    const latest = await client.getLatestBlockNumber({ chain });
    console.log(`✅ 最新区块: #${latest.blockNumber} (链 ID: ${latest.chainId}, 来源: ${latest.provider})`);

    // 查找 2024-01-01 00:00:00 UTC 对应的区块
    const targetTimestamp = String(Math.floor(new Date("2024-01-01T00:00:00Z").getTime() / 1000));
    console.log(`正在通过二分查找定位时间戳 ${targetTimestamp} (2024-01-01) 对应的区块...`);
    const resolvedBlock = await client.getBlockNumberByTimestamp({
      chain,
      timestamp: targetTimestamp,
    });
    console.log(`✅ 定位成功: 时间戳 ${targetTimestamp} 对应区块 #${resolvedBlock.blockNumber}`);
  } catch (err: any) {
    console.warn("⚠️ 纯 RPC 区块查询提示:", err.message);
  }

  // ===========================================================================
  // 2. 历史精确区块原生余额 (client.getNativeBalanceAtBlock)
  // ===========================================================================
  printSection("2. 历史指定区块的原生代币余额 (client.getNativeBalanceAtBlock)");
  try {
    const historicalBlock = "19000000";
    console.log(`正在读取地址 ${address} 在区块 #${historicalBlock} 的 ETH 余额...`);
    const balanceResult = await client.getNativeBalanceAtBlock({
      chain: "ethereum",
      address,
      blockNumber: historicalBlock,
    });
    console.log("✅ 历史原生余额读取成功:");
    console.log(`   - 余额 (Wei):    ${balanceResult.amount}`);
    console.log(`   - 区块哈希:      ${balanceResult.blockHash}`);
    console.log(`   - 使用的 RPC 节点: ${balanceResult.rpcEndpointId}`);
  } catch (err: any) {
    console.warn("⚠️ 历史原生余额读取提示:", err.message);
  }

  // ===========================================================================
  // 3. ERC-20 批量聚合读取 (client.token.getErc20MulticallAtBlock)
  // ===========================================================================
  printSection("3. ERC-20 批量聚合读取 (client.token.getErc20MulticallAtBlock)");
  try {
    const blockNumber = "19000000";
    console.log(`正在区块 #${blockNumber} 批量读取 USDC 与 DAI 合约信息...`);

    const erc20Multicall = await client.token.getErc20MulticallAtBlock({
      chain: "ethereum",
      blockNumber,
      calls: [
        // 读取 USDC 元数据与余额
        { id: "usdc-symbol", tokenAddress: TEST_ADDRESSES.USDC_ETHEREUM, method: "symbol" },
        { id: "usdc-decimals", tokenAddress: TEST_ADDRESSES.USDC_ETHEREUM, method: "decimals" },
        { id: "usdc-balance", tokenAddress: TEST_ADDRESSES.USDC_ETHEREUM, method: "balanceOf", owner: address },
        // 读取 DAI 元数据与余额
        { id: "dai-symbol", tokenAddress: TEST_ADDRESSES.DAI_ETHEREUM, method: "symbol" },
        { id: "dai-decimals", tokenAddress: TEST_ADDRESSES.DAI_ETHEREUM, method: "decimals" },
        { id: "dai-balance", tokenAddress: TEST_ADDRESSES.DAI_ETHEREUM, method: "balanceOf", owner: address },
      ],
    });

    console.log(`✅ Multicall3 批量读取成功 (返回 ${erc20Multicall.results.length} 个结果):`);
    erc20Multicall.results.forEach((r, idx) => {
      console.log(`   [${idx + 1}] ID: ${r.id.padEnd(14)} | 方法: ${r.method.padEnd(10)} | 结果:`, r.success ? r.value : `失败: ${r.error}`);
    });
  } catch (err: any) {
    console.warn("⚠️ ERC-20 Multicall 提示:", err.message);
  }

  // ===========================================================================
  // 4. 通用 JSON-RPC Batch 批量执行 (client.rpc.batch)
  // ===========================================================================
  printSection("4. 通用 JSON-RPC Batch (client.rpc.batch)");
  if (client.rpc) {
    try {
      console.log("正在发送 JSON-RPC Batch 请求 (获取最新区块号与 Chain ID)...");
      const batchResult = await client.rpc.batch([
        { id: 1, jsonrpc: "2.0", method: "eth_blockNumber", params: [] },
        { id: 2, jsonrpc: "2.0", method: "eth_chainId", params: [] },
      ]);

      console.log("✅ JSON-RPC Batch 响应成功:");
      batchResult.forEach((res, i) => {
        console.log(`   [${i + 1}] ID: ${res.id} | 响应结果:`, res.result);
      });
    } catch (err: any) {
      console.warn("⚠️ JSON-RPC Batch 提示:", err.message);
    }
  } else {
    console.log("   (未启用 RPC 模块)");
  }

  await client.close();
  console.log("\n==================================================");
  console.log(" 🎉 示例 05 执行完毕！");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("❌ 示例运行失败:", err);
  process.exit(1);
});
