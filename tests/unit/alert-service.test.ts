import { describe, expect, it } from "vitest";

import { AlertService } from "../../src/alert/AlertService";
import { SlackWebhookReporter } from "../../src/alert/SlackWebhookReporter";
import type { Clock } from "../../src/execution/clock";
import { CredentialPool } from "../../src/execution/CredentialPool";
import { EthereumArchiveRpcPool } from "../../src/rpc/EthereumArchiveRpcPool";
import type { HttpRequest, HttpResponse, HttpTransport } from "../../src/transport/HttpTransport";
import { EvmDataClient } from "../../src/client/EvmDataClient";

class FakeClock implements Clock {
  current = 10_000_000;

  now(): number {
    return this.current;
  }

  advance(ms: number): void {
    this.current += ms;
  }
}

class FakeHttpTransport implements HttpTransport {
  requests: HttpRequest[] = [];

  async request(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: { ok: true },
    };
  }
}

describe("AlertService", () => {
  it("does not report when alert is disabled or webhook is missing", async () => {
    const clock = new FakeClock();
    const transport = new FakeHttpTransport();
    const reporter = new SlackWebhookReporter({ transport });

    const service = new AlertService({
      configuration: { enabled: false, reportIntervalMs: 86_400_000 },
      reporter,
      clock,
    });

    const result = await service.checkAndReportAlerts();
    expect(result).toBe(false);
    expect(transport.requests).toHaveLength(0);
  });

  it("does not send alert when no items have reached 1-day CD", async () => {
    const clock = new FakeClock();
    const transport = new FakeHttpTransport();
    const reporter = new SlackWebhookReporter({ transport });

    const rpcPool = new EthereumArchiveRpcPool({
      endpoints: [{ id: "ep-1", url: "https://ep1.example", envKeyName: "EP1_KEY" }],
      clock,
    });

    const credPool = new CredentialPool(["key-1"], {
      providerConfigurationId: "etherscan",
      clock,
      envKeyNames: ["ETHERSCAN_KEY_1"],
    });

    // ep-1 fails only once (1 min CD, not 1 day CD)
    rpcPool.reportOutcome("ep-1", "failure");

    const service = new AlertService({
      configuration: {
        enabled: true,
        slackWebhookUrl: "https://hooks.slack.com/services/test",
        reportIntervalMs: 86_400_000,
      },
      reporter,
      clock,
      getSources: () => ({
        rpcPools: [rpcPool],
        credentialPools: new Map([["etherscan-1", credPool]]),
      }),
    });

    const result = await service.checkAndReportAlerts();
    expect(result).toBe(false);
    expect(transport.requests).toHaveLength(0);
  });

  it("sends report when a 1-day CD fault exists, throttles within 24 hours, and reports again after 24h", async () => {
    const clock = new FakeClock();
    const transport = new FakeHttpTransport();
    const reporter = new SlackWebhookReporter({ transport });

    const rpcPool = new EthereumArchiveRpcPool({
      endpoints: [{ id: "alchemy-ethereum-1", url: "https://eth.alchemy.example", envKeyName: "ALCHEMY_API_KEY" }],
      clock,
    });

    const credPool = new CredentialPool(["key-1"], {
      providerConfigurationId: "etherscan",
      clock,
      envKeyNames: ["ETHERSCAN_API_KEY_1"],
    });

    // 1. Fail RPC endpoint 10 times to reach 24h max cooldown
    for (let i = 0; i < 10; i += 1) {
      rpcPool.reportOutcome("alchemy-ethereum-1", "failure");
    }
    clock.advance(10_000);

    const service = new AlertService({
      configuration: {
        enabled: true,
        slackWebhookUrl: "https://hooks.slack.com/services/test-webhook",
        reportIntervalMs: 86_400_000,
      },
      reporter,
      clock,
      getSources: () => ({
        rpcPools: [rpcPool],
        credentialPools: new Map([["etherscan-1", credPool]]),
      }),
    });

    // 2. First check: report is sent!
    const sent1 = await service.checkAndReportAlerts();
    expect(sent1).toBe(true);
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.url).toBe("https://hooks.slack.com/services/test-webhook");
    const body = transport.requests[0]?.body as { text: string };
    expect(body.text).toContain("alchemy-ethereum-1");
    expect(body.text).toContain("ALCHEMY_API_KEY");

    // 3. Trigger 1 hour later: throttled by 24h interval
    clock.advance(3_600_000);
    const sentThrottled = await service.checkAndReportAlerts();
    expect(sentThrottled).toBe(false);
    expect(transport.requests).toHaveLength(1);

    // 4. Advance clock beyond 24 hours (86_400_000 ms) and fault still exists: sends second daily report!
    clock.advance(86_400_000);
    const sent2 = await service.checkAndReportAlerts();
    expect(sent2).toBe(true);
    expect(transport.requests).toHaveLength(2);

    // 5. Endpoint recovers on success: clears CD
    rpcPool.reportOutcome("alchemy-ethereum-1", "success");

    // Advance 24 hours again: no faults remain, does not send
    clock.advance(86_400_000);
    const sentAfterRecovery = await service.checkAndReportAlerts();
    expect(sentAfterRecovery).toBe(false);
    expect(transport.requests).toHaveLength(2);
  });

  it("integrates with EvmDataClient.checkAndReportAlerts()", async () => {
    const clock = new FakeClock();
    const transport = new FakeHttpTransport();
    const alertReporter = new SlackWebhookReporter({ transport });

    const client = new EvmDataClient({
      envContent: `
        ALCHEMY_API_KEY=alchemy_test_key_1
        SLACK_WEBHOOK_URL=https://hooks.slack.com/services/client-test
      `,
      chainlink: { enabled: true },
      alert: {
        enabled: true,
        slackWebhookUrl: "https://hooks.slack.com/services/client-test",
      },
    }, {
      clock,
      alertReporter,
    });

    const pool = client.getArchiveRpcPool()!;
    expect(pool).toBeDefined();

    // Cause alchemy-ethereum-1 to reach max cooldown
    for (let i = 0; i < 10; i += 1) {
      pool.reportOutcome("alchemy-ethereum-1", "failure");
    }
    clock.advance(5_000);

    const alerted = await client.checkAndReportAlerts();
    expect(alerted).toBe(true);
    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.url).toBe("https://hooks.slack.com/services/client-test");
    const payload = transport.requests[0]?.body as { text: string };
    expect(payload.text).toContain("alchemy-ethereum-1");
  });

  it("deduplicates multiple endpoints and chains sharing the same API key into a single fault report", () => {
    const clock = new FakeClock();

    const ethPool = new EthereumArchiveRpcPool({
      expectedChainId: 1,
      endpoints: [{ id: "nodereal-ethereum-1", url: "https://eth.nodereal.example", envKeyName: "NODEREAL_RPC_API_KEY1" }],
      clock,
    });
    const basePool = new EthereumArchiveRpcPool({
      expectedChainId: 8453,
      endpoints: [{ id: "nodereal-base-1", url: "https://base.nodereal.example", envKeyName: "NODEREAL_RPC_API_KEY1" }],
      clock,
    });

    const alchemyPool = new EthereumArchiveRpcPool({
      expectedChainId: 1,
      endpoints: [{ id: "alchemy-ethereum-1", url: "https://eth.alchemy.example", envKeyName: "ALCHEMY_API_KEY_1" }],
      clock,
    });
    const alchemyCredPool = new CredentialPool(["key-alch-1"], {
      providerConfigurationId: "alchemy-1",
      clock,
      envKeyNames: ["ALCHEMY_API_KEY_1"],
    });

    // Fail nodereal on both ethereum and base
    for (let i = 0; i < 10; i += 1) {
      ethPool.reportOutcome("nodereal-ethereum-1", "failure");
      basePool.reportOutcome("nodereal-base-1", "failure");
      alchemyPool.reportOutcome("alchemy-ethereum-1", "failure");
    }
    // Fail alchemy cred pool
    alchemyCredPool.restoreCooldownState("alchemy-1-key-1", {
      consecutiveFailures: 10,
      currentCooldownMs: 86_400_000,
      cooldownUntil: clock.now() + 86_400_000,
      firstFailureAt: clock.now() - 86_400_000,
    });

    const service = new AlertService({
      configuration: {
        enabled: true,
        slackWebhookUrl: "https://hooks.slack.com/services/test-webhook",
        reportIntervalMs: 86_400_000,
      },
      clock,
      getSources: () => ({
        rpcPools: [ethPool, basePool, alchemyPool],
        credentialPools: new Map([["alchemy", alchemyCredPool]]),
      }),
    });

    const items = service.collectFaultItems();
    // Exactly 2 items instead of 4: one for NODEREAL_RPC_API_KEY1, one for ALCHEMY_API_KEY_1
    expect(items).toHaveLength(2);

    const noderealItem = items.find((it) => it.envKeyName === "NODEREAL_RPC_API_KEY1");
    expect(noderealItem).toBeDefined();
    expect(noderealItem?.category).toBe("rpc");
    expect(noderealItem?.detail).toContain("ethereum");
    expect(noderealItem?.detail).toContain("base");
    expect(noderealItem?.detail).toContain("nodereal-ethereum-1");
    expect(noderealItem?.detail).toContain("nodereal-base-1");

    const alchemyItem = items.find((it) => it.envKeyName === "ALCHEMY_API_KEY_1");
    expect(alchemyItem).toBeDefined();
    expect(alchemyItem?.category).toBe("api-key");
    expect(alchemyItem?.detail).toContain("alchemy");
    expect(alchemyItem?.detail).toContain("data-api");
    expect(alchemyItem?.detail).toContain("rpc");

    const summaries = service.collectKeyFamilySummaries();
    expect(summaries).toHaveLength(2);
    const noderealSummary = summaries.find((s) => s.family === "NODEREAL_RPC_API_KEY");
    expect(noderealSummary).toBeDefined();
    expect(noderealSummary?.displayName).toBe("NodeReal RPC");
    expect(noderealSummary?.totalKeys).toBe(1);
    expect(noderealSummary?.failedKeys).toBe(1);
    expect(noderealSummary?.availableKeys).toBe(0);

    const alchemySummary = summaries.find((s) => s.family === "ALCHEMY_API_KEY");
    expect(alchemySummary).toBeDefined();
    expect(alchemySummary?.displayName).toBe("Alchemy");
    expect(alchemySummary?.totalKeys).toBe(1);
    expect(alchemySummary?.failedKeys).toBe(1);
    expect(alchemySummary?.availableKeys).toBe(0);
  });
});
