import { describe, expect, it } from "vitest";

import {
  SlackWebhookReporter,
  buildSlackAlertPayload,
  formatDuration,
  type AlertFaultItem,
} from "../../src/alert/SlackWebhookReporter";
import type { HttpRequest, HttpResponse, HttpTransport } from "../../src/transport/HttpTransport";

class FakeHttpTransport implements HttpTransport {
  requests: HttpRequest[] = [];
  responseStatus = 200;
  responseBody: unknown = { ok: true };
  shouldThrow = false;

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    if (this.shouldThrow) {
      throw new Error("Network connection reset");
    }
    return {
      status: this.responseStatus,
      headers: { "content-type": "application/json" },
      body: this.responseBody,
    };
  }
}

describe("SlackWebhookReporter", () => {
  describe("formatDuration", () => {
    it("formats minutes, hours, and days correctly", () => {
      expect(formatDuration(0)).toBe("0分钟");
      expect(formatDuration(30_000)).toBe("0分钟");
      expect(formatDuration(45 * 60_000)).toBe("45分钟");
      expect(formatDuration(2 * 3_600_000 + 15 * 60_000)).toBe("2小时 15分钟");
      expect(formatDuration(2 * 3_600_000)).toBe("2小时");
      expect(formatDuration(24 * 3_600_000)).toBe("1天");
      expect(formatDuration(26 * 3_600_000 + 15 * 60_000)).toBe("1天 2小时");
    });
  });

  describe("buildSlackAlertPayload", () => {
    it("builds a descriptive, redaction-safe Slack payload", () => {
      const items: AlertFaultItem[] = [
        {
          id: "alchemy-ethereum-1",
          category: "rpc",
          envKeyName: "ALCHEMY_API_KEY",
          detail: "chain: ethereum, provider: alchemy",
          totalCooldownDurationMs: 26 * 3_600_000,
          currentCooldownMs: 86_400_000,
        },
        {
          id: "etherscan-main-key-1",
          category: "data-api",
          envKeyName: "ETHERSCAN_API_KEY_1",
          detail: "chain: ethereum, provider: etherscan",
          totalCooldownDurationMs: 24 * 3_600_000,
          currentCooldownMs: 86_400_000,
        },
      ];

      const payload = buildSlackAlertPayload(items);

      expect(payload.text).toContain("alchemy-ethereum-1");
      expect(payload.text).toContain("ALCHEMY_API_KEY");
      expect(payload.text).toContain("1天 2小时");
      expect(payload.text).toContain("etherscan-main-key-1");
      expect(payload.text).toContain("ETHERSCAN_API_KEY_1");
      expect(payload.blocks).toBeDefined();
      expect(payload.blocks?.length).toBeGreaterThan(2);

      // Verify no secret tokens leaked
      const stringified = JSON.stringify(payload);
      expect(stringified).not.toContain("secret");
      expect(stringified).not.toContain("token=");
    });
  });

  describe("report", () => {
    it("skips network call if items array is empty", async () => {
      const transport = new FakeHttpTransport();
      const reporter = new SlackWebhookReporter({ transport });

      const result = await reporter.report("https://hooks.slack.com/services/T00/B00/X00", []);

      expect(result.success).toBe(true);
      expect(transport.requests).toHaveLength(0);
    });

    it("sends a valid POST request to Slack webhook URL", async () => {
      const transport = new FakeHttpTransport();
      const reporter = new SlackWebhookReporter({ transport });

      const items: AlertFaultItem[] = [
        {
          id: "alchemy-ethereum-1",
          category: "rpc",
          envKeyName: "ALCHEMY_API_KEY",
          detail: "chain: ethereum, provider: alchemy",
          totalCooldownDurationMs: 86_400_000,
          currentCooldownMs: 86_400_000,
        },
      ];

      const webhookUrl = "https://hooks.slack.com/services/T00/B00/X00";
      const result = await reporter.report(webhookUrl, items);

      expect(result.success).toBe(true);
      expect(result.status).toBe(200);
      expect(transport.requests).toHaveLength(1);
      expect(transport.requests[0]?.url).toBe(webhookUrl);
      expect(transport.requests[0]?.method).toBe("POST");
      expect(transport.requests[0]?.headers?.["content-type"]).toBe("application/json");
      expect(transport.requests[0]?.body).toEqual(buildSlackAlertPayload(items));
    });

    it("handles non-200 responses safely without throwing", async () => {
      const transport = new FakeHttpTransport();
      transport.responseStatus = 500;
      const reporter = new SlackWebhookReporter({ transport });

      const items: AlertFaultItem[] = [
        {
          id: "alchemy-ethereum-1",
          category: "rpc",
          envKeyName: "ALCHEMY_API_KEY",
          detail: "chain: ethereum",
          totalCooldownDurationMs: 86_400_000,
          currentCooldownMs: 86_400_000,
        },
      ];

      const result = await reporter.report("https://hooks.slack.com/services/fail", items);

      expect(result.success).toBe(false);
      expect(result.status).toBe(500);
      expect(result.error).toContain("HTTP 500");
    });

    it("catches network errors safely without crashing", async () => {
      const transport = new FakeHttpTransport();
      transport.shouldThrow = true;
      const reporter = new SlackWebhookReporter({ transport });

      const items: AlertFaultItem[] = [
        {
          id: "alchemy-ethereum-1",
          category: "rpc",
          envKeyName: "ALCHEMY_API_KEY",
          detail: "chain: ethereum",
          totalCooldownDurationMs: 86_400_000,
          currentCooldownMs: 86_400_000,
        },
      ];

      const result = await reporter.report("https://hooks.slack.com/services/throw", items);

      expect(result.success).toBe(false);
      expect(result.error).toBe("Network connection reset");
    });
  });
});
