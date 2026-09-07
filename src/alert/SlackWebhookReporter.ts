import { AxiosHttpTransport } from "../transport/AxiosHttpTransport";
import type { HttpTransport } from "../transport/HttpTransport";

export interface AlertFaultItem {
  readonly id: string; // Endpoint or credential ID, or envKeyName when aggregated
  readonly category: "rpc" | "data-api" | "api-key";
  readonly envKeyName: string; // e.g. "ALCHEMY_API_KEY", "ETHERSCAN_API_KEY_1", or "BUILTIN_PUBLIC"
  readonly detail: string; // e.g. "chain: ethereum, provider: alchemy"
  readonly totalCooldownDurationMs: number; // Cumulative duration in cooldown
  readonly currentCooldownMs: number; // Current CD tier (86,400,000ms for max 1 day)
}

export interface SlackWebhookPayload {
  readonly text: string;
  readonly blocks?: readonly unknown[];
}

export interface SlackWebhookReporterOptions {
  readonly transport?: HttpTransport;
  readonly timeoutMs?: number;
}

export interface SlackWebhookReportResult {
  readonly success: boolean;
  readonly status?: number | null;
  readonly error?: string;
}

export function formatDuration(durationMs: number): string {
  if (durationMs <= 0) {
    return "0分钟";
  }
  const totalMinutes = Math.floor(durationMs / 60_000);
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return hours > 0 ? `${days}天 ${hours}小时` : `${days}天`;
  }
  if (hours > 0) {
    return minutes > 0 ? `${hours}小时 ${minutes}分钟` : `${hours}小时`;
  }
  return `${minutes}分钟`;
}

export function buildSlackAlertPayload(items: readonly AlertFaultItem[]): SlackWebhookPayload {
  const summaryLine = `🚨 [EVM-Data-SDK] 节点与凭证冷却告警: 共有 ${items.length} 个项目达到 24 小时最大冷却 (1天)`;
  const lines = items.map((item, index) => {
    const categoryTag = item.category.toUpperCase();
    const durationText = formatDuration(item.totalCooldownDurationMs);
    if (item.id === item.envKeyName) {
      return `${index + 1}. [${categoryTag}] ${item.envKeyName}\n   - 详情: ${item.detail}\n   - 持续故障时长: ${durationText}`;
    }
    return `${index + 1}. [${categoryTag}] ${item.id} (Env: ${item.envKeyName})\n   - 详情: ${item.detail}\n   - 持续故障时长: ${durationText}`;
  });

  const fullText = `${summaryLine}\n\n${lines.join("\n\n")}`;

  const blocks = [
    {
      type: "header",
      text: {
        type: "plain_text",
        text: "🚨 EVM-Data-SDK 24小时 CD 故障告警",
        emoji: true,
      },
    },
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*共有 ${items.length} 个 API Key 或节点处于 1 天最大冷却状态，可能需要检查配额或更换配置：*`,
      },
    },
    ...items.map((item) => {
      const isApiKey = item.id === item.envKeyName;
      const fields = [
        {
          type: "mrkdwn",
          text: `*类别:*\n${item.category.toUpperCase()}`,
        },
        ...(isApiKey
          ? [
              {
                type: "mrkdwn",
                text: `*API Key 环境变量:*\n\`${item.envKeyName}\``,
              },
            ]
          : [
              {
                type: "mrkdwn",
                text: `*ID:*\n\`${item.id}\``,
              },
              {
                type: "mrkdwn",
                text: `*环境变量:*\n\`${item.envKeyName}\``,
              },
            ]),
        {
          type: "mrkdwn",
          text: `*持续故障时长:*\n${formatDuration(item.totalCooldownDurationMs)}`,
        },
        {
          type: "mrkdwn",
          text: `*详情 / 影响范围:*\n${item.detail}`,
        },
      ];
      return {
        type: "section",
        fields,
      };
    }),
  ];

  return Object.freeze({
    text: fullText,
    blocks: Object.freeze(blocks),
  });
}

export class SlackWebhookReporter {
  private readonly transport: HttpTransport;
  private readonly timeoutMs: number;

  constructor(options: SlackWebhookReporterOptions = {}) {
    this.transport = options.transport ?? new AxiosHttpTransport();
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async report(
    webhookUrl: string,
    items: readonly AlertFaultItem[],
    signal?: AbortSignal,
  ): Promise<SlackWebhookReportResult> {
    if (items.length === 0) {
      return { success: true };
    }

    const payload = buildSlackAlertPayload(items);

    try {
      const response = await this.transport.request({
        method: "POST",
        url: webhookUrl,
        headers: { "content-type": "application/json" },
        body: payload,
        timeoutMs: this.timeoutMs,
        ...(signal !== undefined ? { signal } : {}),
      });

      const isOk = response.status >= 200 && response.status < 300;
      return {
        success: isOk,
        status: response.status,
        ...(isOk ? {} : { error: `Webhook returned HTTP ${response.status}` }),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: message,
      };
    }
  }
}
