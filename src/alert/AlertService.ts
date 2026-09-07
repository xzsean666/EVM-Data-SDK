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

interface RawFault {
  readonly id: string;
  readonly category: "rpc" | "data-api";
  readonly envKeyName?: string | undefined;
  readonly chainName?: string | undefined;
  readonly expectedChainId?: number | undefined;
  readonly providerId?: string | undefined;
  readonly totalCooldownDurationMs: number;
  readonly currentCooldownMs: number;
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
    const rawFaults: RawFault[] = [];
    const seenRawKeys = new Set<string>();

    // 1. RPC Pools
    if (effectiveSources.rpcPools !== undefined) {
      for (const pool of effectiveSources.rpcPools) {
        const states = pool.getAllCooldownStates(now);
        for (const state of states) {
          if (state.isMaxCooldown) {
            const rawKey = `rpc:${pool.expectedChainId}:${state.id}`;
            if (seenRawKeys.has(rawKey)) continue;
            seenRawKeys.add(rawKey);

            const chainName = pool.expectedChainId === 8453 ? "base" : "ethereum";
            rawFaults.push({
              id: state.id,
              category: "rpc",
              envKeyName: state.envKeyName,
              chainName,
              expectedChainId: pool.expectedChainId,
              totalCooldownDurationMs: state.totalCooldownDurationMs,
              currentCooldownMs: state.currentCooldownMs,
            });
          }
        }
      }
    }

    // 2. Credential Pools
    if (effectiveSources.credentialPools !== undefined) {
      for (const [providerId, pool] of effectiveSources.credentialPools) {
        const maxStates = pool.getMaxCooldownCredentials(now);
        for (const state of maxStates) {
          const rawKey = `cred:${providerId}:${state.id}`;
          if (seenRawKeys.has(rawKey)) continue;
          seenRawKeys.add(rawKey);

          rawFaults.push({
            id: state.id,
            category: "data-api",
            envKeyName: state.envKeyName ?? providerId.toUpperCase(),
            providerId,
            totalCooldownDurationMs: state.totalCooldownDurationMs,
            currentCooldownMs: state.currentCooldownMs,
          });
        }
      }
    }

    const grouped = new Map<string, RawFault[]>();
    for (const fault of rawFaults) {
      const isApiKey =
        typeof fault.envKeyName === "string" &&
        fault.envKeyName.trim().length > 0 &&
        fault.envKeyName !== "BUILTIN_PUBLIC";
      const groupKey = isApiKey ? `env:${fault.envKeyName.trim()}` : `id:${fault.category}:${fault.id}`;
      const list = grouped.get(groupKey);
      if (list === undefined) {
        grouped.set(groupKey, [fault]);
      } else {
        list.push(fault);
      }
    }

    const items: AlertFaultItem[] = [];
    for (const faults of grouped.values()) {
      const first = faults[0]!;
      const isApiKey =
        typeof first.envKeyName === "string" &&
        first.envKeyName.trim().length > 0 &&
        first.envKeyName !== "BUILTIN_PUBLIC";

      const totalCooldownDurationMs = Math.max(...faults.map((f) => f.totalCooldownDurationMs));
      const currentCooldownMs = Math.max(...faults.map((f) => f.currentCooldownMs));

      if (isApiKey) {
        const envKeyName = first.envKeyName!.trim();
        const hasRpc = faults.some((f) => f.category === "rpc");
        const hasDataApi = faults.some((f) => f.category === "data-api");
        const category: "rpc" | "data-api" | "api-key" =
          hasRpc && hasDataApi ? "api-key" : hasRpc ? "rpc" : "data-api";

        const rpcChains = Array.from(
          new Set(faults.filter((f) => f.category === "rpc" && f.chainName).map((f) => f.chainName!)),
        );
        const providers = Array.from(
          new Set(faults.filter((f) => f.category === "data-api" && f.providerId).map((f) => f.providerId!)),
        );
        const endpointIds = Array.from(new Set(faults.map((f) => f.id)));

        let detail: string;
        if (hasRpc && hasDataApi) {
          const providerText = providers.length > 0 ? providers.join(", ") : "data-api";
          const chainText = rpcChains.length > 0 ? `rpc: ${rpcChains.join(", ")}` : "rpc";
          detail = `provider: ${providerText} (data-api, ${chainText})`;
        } else if (hasRpc) {
          const chainText =
            rpcChains.length > 1
              ? `chains: ${rpcChains.join(", ")}`
              : `chain: ${rpcChains[0] ?? "ethereum"}`;
          detail = `${chainText} (endpoints: ${endpointIds.join(", ")})`;
        } else {
          const providerText = providers.length > 0 ? providers.join(", ") : "data-api";
          detail = `provider: ${providerText} (data-api)`;
        }

        items.push(
          Object.freeze({
            id: envKeyName,
            category,
            envKeyName,
            detail,
            totalCooldownDurationMs,
            currentCooldownMs,
          }),
        );
      } else {
        const chainName = first.chainName ?? "ethereum";
        items.push(
          Object.freeze({
            id: first.id,
            category: first.category,
            envKeyName: first.envKeyName ?? "BUILTIN_PUBLIC",
            detail: `chain: ${chainName}, expectedChainId: ${first.expectedChainId ?? 1}`,
            totalCooldownDurationMs,
            currentCooldownMs,
          }),
        );
      }
    }

    return Object.freeze(items);
  }

  async checkAndReportAlerts(
    sources?: AlertSources,
    now = this.clock.now(),
    options?: { readonly force?: boolean },
  ): Promise<boolean> {
    if (!this.configuration.enabled || !this.configuration.slackWebhookUrl) {
      return false;
    }

    const interval = this.configuration.reportIntervalMs;
    if (!options?.force && this.lastReportSentAt !== null && now - this.lastReportSentAt < interval) {
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
