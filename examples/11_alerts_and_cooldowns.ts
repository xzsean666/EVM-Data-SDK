/**
 * 示例 11: 告警上报与故障冷却管理 (AlertService & CooldownTracker)
 *
 * 功能说明:
 * 1. 被动故障熔断与指数阶梯冷却 (CooldownTracker):
 *    - 当某个 RPC 节点或数据服务商 API Key 连续出现超时、网络错误或 429 限流时，自动触发阶梯冷却 (1s -> 5s -> 15s -> 30s -> 60s -> ...)。
 *    - 冷却期间自动跳过该节点/Key，优先路由至其他健康备用节点。
 * 2. 跨进程重启持久化冷却 (CooldownStore):
 *    - 冷却状态与连续失败次数会自动同步到 SQLite / PostgreSQL 数据库。
 *    - 进程重新启动时调用 client.restorePersistedCooldowns() 即可瞬间恢复故障节点隔离状态，无需重新“踩坑”。
 * 3. Slack Webhook 故障告警聚合上报 (AlertService):
 *    - 汇总所有处于冷却中的 RPC 节点与 API Key。
 *    - 自动静默去重 (避免告警风暴)，按配置周期或阈值向 Slack 频道推送排障信息。
 *
 * 依赖说明:
 * - 可在 .env.key 中配置 SLACK_WEBHOOK_URL 用于接收真实通知。
 *
 * 运行方式:
 *   node examples/11_alerts_and_cooldowns.ts
 */

import { createExampleClient, printHeader, printSection } from "./common.ts";

async function main() {
  printHeader("示例 11: 告警上报与故障冷却管理 (Alerts & Cooldowns)");

  const client = createExampleClient({
    alert: {
      enabled: true,
      reportIntervalMs: 60_000, // 每 60 秒可上报一次
    },
  });

  await client.initialize();

  // ===========================================================================
  // 1. 查看与恢复持久化的冷却记录 (CooldownStore)
  // ===========================================================================
  printSection("1. 查看与恢复持久化的故障冷却记录");
  try {
    const records = await client.cooldownStore.loadAll();
    console.log(`✅ 从本地存储加载到 ${records.length} 条已持久化的故障冷却记录:`);
    if (records.length === 0) {
      console.log("   (暂无故障记录，说明当前所有节点与 API Key 均处于健康状态)");
    } else {
      records.forEach((r, idx) => {
        console.log(`   [${idx + 1}] 资源: ${r.resourceKey} | 类别: ${r.category}`);
        console.log(`       连续失败次数: ${r.failureCount} | 冷却时长: ${r.currentCooldownMs}ms`);
        console.log(`       冷却截止时间: ${r.cooldownUntil ? new Date(r.cooldownUntil).toISOString() : "无"}`);
      });
    }

    // 显式恢复
    console.log("\n正在执行 client.restorePersistedCooldowns()...");
    await client.restorePersistedCooldowns();
    console.log("✅ 冷却状态已成功注入内存各连接池与路由层");
  } catch (err: any) {
    console.warn("⚠️ 冷却状态加载提示:", err.message);
  }

  // ===========================================================================
  // 2. 检测与触发告警上报 (client.checkAndReportAlerts)
  // ===========================================================================
  printSection("2. 检测与触发告警上报 (client.checkAndReportAlerts)");
  try {
    console.log("正在检查当前系统是否有处于冷却中的故障节点并生成告警...");

    // force: true 表示强制检查并输出，忽略最小发送间隔
    const reported = await client.checkAndReportAlerts(Date.now(), { force: true });
    if (reported) {
      console.log("📢 发现故障节点，告警信息已成功推送至 Slack Webhook！");
    } else {
      console.log("✅ 系统状态健康，未发现达到告警阈值的故障资源。");
      console.log("   (若配置了 SLACK_WEBHOOK_URL 且有节点处于冷却状态，将自动发送卡片消息)");
    }
  } catch (err: any) {
    console.warn("⚠️ 告警检查提示:", err.message);
  }

  await client.close();
  console.log("\n==================================================");
  console.log(" 🎉 示例 11 执行完毕！");
  console.log("==================================================");
}

main().catch((err) => {
  console.error("❌ 示例运行失败:", err);
  process.exit(1);
});
