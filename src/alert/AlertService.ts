import type { NormalizedAlertConfiguration } from "../domain/configuration";
import type { Clock } from "../execution/clock";
import { systemClock } from "../execution/clock";
import type { CredentialPool } from "../execution/CredentialPool";
import type { EthereumArchiveRpcPool } from "../rpc/EthereumArchiveRpcPool";
import { SlackWebhookReporter, type AlertFaultItem } from "./SlackWebhookReporter";

export interface AlertSources {
  readonly rpcPools?: readonly EthereumArchiveRpcPool[];
  readonly credentialPools?: ReadonlyMap<string, CredentialPool>;
}

export interface AlertServiceOptions {
  readonly configuration: NormalizedAlertConfiguration;
  readonly reporter?: SlackWebhookReporter | undefined;
  readonly clock?: Clock | undefined;
  readonly getSources?: (() => AlertSources) | undefined;
}

export class AlertService {
  private readonly configuration: NormalizedAlertConfiguration;
  private readonly reporter: SlackWebhookReporter;
  private readonly clock: Clock;
  private readonly getSources?: (() => AlertSources) | undefined;
  private lastReportSentAt: number | null = null;

  constructor(options: AlertServiceOptions) {
    this.configuration = options.configuration;
    this.reporter = options.reporter ?? new SlackWebhookReporter();
    this.clock = options.clock ?? systemClock;
    this.getSources = options.getSources;
  }

  collectFaultItems(sources?: AlertSources, now = this.clock.now()): readonly AlertFaultItem[] {
    const effectiveSources = sources ?? this.getSources?.() ?? {};
    const items: AlertFaultItem[] = [];
    const seenIds = new Set<string>();

    // 1. RPC Pools
    if (effectiveSources.rpcPools !== undefined) {
      for (const pool of effectiveSources.rpcPools) {
        const states = pool.getAllCooldownStates(now);
        for (const state of states) {
          if (state.isMaxCooldown && !seenIds.has(state.id)) {
            seenIds.add(state.id);
            const chainName = pool.expectedChainId === 8453 ? "base" : "ethereum";
            items.push(
              Object.freeze({
                id: state.id,
                category: "rpc",
                envKeyName: state.envKeyName ?? "BUILTIN_PUBLIC",
                detail: `chain: ${chainName}, expectedChainId: ${pool.expectedChainId}`,
                totalCooldownDurationMs: state.totalCooldownDurationMs,
                currentCooldownMs: state.currentCooldownMs,
              }),
            );
          }
        }
      }
    }

    // 2. Credential Pools
    if (effectiveSources.credentialPools !== undefined) {
      for (const [providerId, pool] of effectiveSources.credentialPools) {
        const maxStates = pool.getMaxCooldownCredentials(now);
        for (const state of maxStates) {
          if (!seenIds.has(state.id)) {
            seenIds.add(state.id);
            items.push(
              Object.freeze({
                id: state.id,
                category: "data-api",
                envKeyName: state.envKeyName ?? providerId.toUpperCase(),
                detail: `provider: ${providerId}`,
                totalCooldownDurationMs: state.totalCooldownDurationMs,
                currentCooldownMs: state.currentCooldownMs,
              }),
            );
          }
        }
      }
    }

    return Object.freeze(items);
  }

  async checkAndReportAlerts(sources?: AlertSources, now = this.clock.now()): Promise<boolean> {
    if (!this.configuration.enabled || !this.configuration.slackWebhookUrl) {
      return false;
    }

    const interval = this.configuration.reportIntervalMs;
    if (this.lastReportSentAt !== null && now - this.lastReportSentAt < interval) {
      return false;
    }

    const faultItems = this.collectFaultItems(sources, now);
    if (faultItems.length === 0) {
      return false;
    }

    const result = await this.reporter.report(this.configuration.slackWebhookUrl, faultItems);
    if (result.success) {
      this.lastReportSentAt = now;
      return true;
    }

    return false;
  }

  getLastReportSentAt(): number | null {
    return this.lastReportSentAt;
  }
}
