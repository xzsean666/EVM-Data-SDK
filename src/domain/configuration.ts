import { z } from "zod";

import type { ChainDefinition, BuiltinProviderName } from "./chains";
import { parseChainDefinition } from "./chains";
import { invalidConfiguration } from "./errors";
import type { OperationName } from "./operations";
import type { TokenPriceProviderName } from "./priceModels";

export const DEFAULT_ATTEMPT_TIMEOUT_MS = 10_000;
export const DEFAULT_TOTAL_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_TOTAL_ATTEMPTS = 6;
export const DEFAULT_MAX_RANGE_RECORDS = 100_000;
export const DEFAULT_MAX_RANGE_WINDOWS = 4_096;

export interface RequestPolicy {
  readonly attemptTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxTotalAttempts?: number;
  readonly allowDirect?: boolean;
  readonly providerPacingMs?: Readonly<Record<string, number>>;
}

export interface NormalizedRequestPolicy {
  readonly attemptTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly maxTotalAttempts: number;
  readonly allowDirect: boolean;
  readonly providerPacingMs: Readonly<Record<string, number>>;
}

export interface ProxyConfiguration {
  readonly url: string;
}

export interface SingBoxRuntimeConfiguration {
  readonly version?: string;
  readonly binaryPath?: string;
  readonly cacheDir?: string;
  readonly downloadMode?: "lazy" | "eager";
  readonly startupTimeoutMs?: number;
}

export interface SingBoxProxyConfiguration {
  readonly kind: "sing-box";
  readonly urls: readonly string[];
  readonly singBox?: SingBoxRuntimeConfiguration;
}

export interface NormalizedSingBoxRuntimeConfiguration {
  readonly version: string;
  readonly binaryPath?: string;
  readonly cacheDir?: string;
  readonly downloadMode: "lazy" | "eager";
  readonly startupTimeoutMs: number;
}

export interface NormalizedSingBoxProxyConfiguration {
  readonly kind: "sing-box";
  readonly urls: readonly string[];
  readonly singBox: NormalizedSingBoxRuntimeConfiguration;
}

export interface TelemetryEvent {
  readonly operation: OperationName;
  readonly chainId: number | null;
  readonly provider: string | null;
  readonly attempt: number;
  readonly durationMs: number;
  readonly outcome: "success" | "failure";
  readonly errorCode?: string;
}

export type ObservationCallback = (event: TelemetryEvent) => void;

export interface ProviderConfigurationBase {
  readonly apiKeys: readonly string[];
  readonly baseUrl?: string;
  readonly allowInsecureHttp?: boolean;
}

export interface PriceProviderConfiguration {
  readonly kind: TokenPriceProviderName;
  readonly baseUrl?: string;
  readonly enabled?: boolean;
  readonly allowInsecureHttp?: boolean;
}

export interface PriceConfiguration {
  readonly providers?: readonly PriceProviderConfiguration[];
  readonly routeMode?: "direct" | "proxy-only";
  readonly attemptTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxProviderConcurrency?: number;
  readonly tokenAliases?: Readonly<Record<string, string>>;
  readonly geckoNetworks?: readonly string[];
}

export interface NormalizedPriceProviderConfiguration {
  readonly kind: TokenPriceProviderName;
  readonly baseUrl?: string;
  readonly allowInsecureHttp: boolean;
}

export interface NormalizedPriceConfiguration {
  readonly providers: readonly NormalizedPriceProviderConfiguration[];
  readonly routeMode: "direct" | "proxy-only";
  readonly attemptTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly maxProviderConcurrency: number;
  readonly tokenAliases: Readonly<Record<string, string>>;
  readonly geckoNetworks: readonly string[];
}

interface NormalizedProviderConfigurationBase {
  readonly apiKeys: readonly string[];
  readonly baseUrl?: string;
  readonly allowInsecureHttp: boolean;
}

export interface EtherscanConfiguration extends ProviderConfigurationBase {
  readonly kind: "etherscan";
}

export interface BlockscoutConfiguration extends ProviderConfigurationBase {
  readonly kind: "blockscout";
}

export interface AlchemyConfiguration extends ProviderConfigurationBase {
  readonly kind: "alchemy";
}

export interface MoralisConfiguration extends ProviderConfigurationBase {
  readonly kind: "moralis";
}

export type ProviderConfiguration =
  | EtherscanConfiguration
  | BlockscoutConfiguration
  | AlchemyConfiguration
  | MoralisConfiguration;

interface NormalizedEtherscanConfiguration extends NormalizedProviderConfigurationBase {
  readonly kind: "etherscan";
}

interface NormalizedBlockscoutConfiguration extends NormalizedProviderConfigurationBase {
  readonly kind: "blockscout";
}

interface NormalizedAlchemyConfiguration extends NormalizedProviderConfigurationBase {
  readonly kind: "alchemy";
}

interface NormalizedMoralisConfiguration extends NormalizedProviderConfigurationBase {
  readonly kind: "moralis";
}

type NormalizedProviderConfiguration =
  | NormalizedEtherscanConfiguration
  | NormalizedBlockscoutConfiguration
  | NormalizedAlchemyConfiguration
  | NormalizedMoralisConfiguration;

/**
 * One direct-only Ethereum Archive RPC endpoint used exclusively by the
 * opt-in Chainlink Archive RPC feature (see ADR-028/ADR-029). Never routed
 * through `ProxyPool` or `SingBoxProxyManager`.
 */
export interface EthereumArchiveRpcEndpointConfiguration {
  /** Unique redaction-safe identifier used in status and telemetry. */
  readonly id: string;
  /** HTTPS JSON-RPC URL. It may contain a caller-owned token and is secret. */
  readonly url: string;
  readonly enabled?: boolean;
}

export interface ChainlinkConfiguration {
  readonly enabled?: boolean;
  /** Defaults to true when chainlink.enabled is true. */
  readonly useBuiltinEthereumArchiveRpcs?: boolean;
  /** Appended to built-ins; IDs and normalized URLs must be unique. */
  readonly rpcEndpoints?: readonly EthereumArchiveRpcEndpointConfiguration[];
  readonly healthCheckTimeoutMs?: number;
  readonly attemptTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxCallsPerMulticall?: number;
  readonly maxRpcAttempts?: number;
  /** Number of Archive RPC endpoints raced per attempt wave. Defaults to 1. */
  readonly maxConcurrentRpcAttempts?: number;
}

export interface NormalizedEthereumArchiveRpcEndpointConfiguration {
  readonly id: string;
  readonly url: string;
  readonly enabled: boolean;
}

export interface NormalizedChainlinkConfiguration {
  readonly enabled: boolean;
  readonly useBuiltinEthereumArchiveRpcs: boolean;
  readonly rpcEndpoints: readonly NormalizedEthereumArchiveRpcEndpointConfiguration[];
  readonly healthCheckTimeoutMs: number;
  readonly attemptTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly maxCallsPerMulticall: number;
  readonly maxRpcAttempts: number;
  readonly maxConcurrentRpcAttempts: number;
}

export interface DeFiConfiguration {
  readonly enabled?: boolean;
  /** Defaults to both supported chains when DeFi is enabled. */
  readonly chains?: readonly ("ethereum" | "base")[];
  /** Defaults to true when DeFi is enabled. */
  readonly useBuiltinArchiveRpcs?: boolean;
  /** Explicit endpoint lists are appended to the corresponding built-in pool. */
  readonly rpcEndpoints?: Partial<Record<"ethereum" | "base", readonly EthereumArchiveRpcEndpointConfiguration[]>>;
  readonly healthCheckTimeoutMs?: number;
  readonly attemptTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxCallsPerMulticall?: number;
  readonly maxRpcAttempts?: number;
  /** Number of Archive RPC endpoints raced per attempt wave. Defaults to 1. */
  readonly maxConcurrentRpcAttempts?: number;
}

export interface UniswapV3Configuration {
  readonly enabled?: boolean;
  readonly useBuiltinEthereumArchiveRpcs?: boolean;
  readonly rpcEndpoints?: readonly EthereumArchiveRpcEndpointConfiguration[];
  readonly healthCheckTimeoutMs?: number;
  readonly attemptTimeoutMs?: number;
  readonly totalTimeoutMs?: number;
  readonly maxCallsPerMulticall?: number;
  readonly maxRpcAttempts?: number;
}
export interface UniswapV4Configuration extends UniswapV3Configuration {}
export interface NormalizedUniswapV4Configuration extends NormalizedUniswapV3Configuration {}

export interface NormalizedUniswapV3Configuration {
  readonly enabled: boolean;
  readonly useBuiltinEthereumArchiveRpcs: boolean;
  readonly rpcEndpoints: readonly NormalizedEthereumArchiveRpcEndpointConfiguration[];
  readonly healthCheckTimeoutMs: number;
  readonly attemptTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly maxCallsPerMulticall: number;
  readonly maxRpcAttempts: number;
}

export interface NormalizedDeFiConfiguration {
  readonly enabled: boolean;
  readonly chains: readonly ("ethereum" | "base")[];
  readonly useBuiltinArchiveRpcs: boolean;
  readonly rpcEndpoints: Readonly<Record<"ethereum" | "base", readonly NormalizedEthereumArchiveRpcEndpointConfiguration[]>>;
  readonly healthCheckTimeoutMs: number;
  readonly attemptTimeoutMs: number;
  readonly totalTimeoutMs: number;
  readonly maxCallsPerMulticall: number;
  readonly maxRpcAttempts: number;
  readonly maxConcurrentRpcAttempts: number;
}

export interface ClientConfiguration {
  readonly storage?: StorageConfiguration;
  readonly sync?: SyncConfiguration;
  readonly replay?: ReplayConfiguration;
  readonly providers?: readonly ProviderConfiguration[];
  readonly price?: PriceConfiguration;
  readonly chains?: readonly ChainDefinition[];
  readonly requestPolicy?: RequestPolicy;
  readonly proxies?: readonly ProxyConfiguration[];
  readonly advancedProxy?: SingBoxProxyConfiguration;
  /** Explicit memory safety bound for one completed block-range request. */
  readonly maxRangeRecords?: number;
  /** Explicit progress bound for adaptive closed-range splitting. */
  readonly maxRangeWindows?: number;
  /** Opt-in Chainlink Archive RPC snapshot feature (v0.4, ADR-028). */
  readonly chainlink?: ChainlinkConfiguration;
  /** Opt-in exact-block DeFi exchange-rate snapshot feature (v0.5). */
  readonly defi?: DeFiConfiguration;
  readonly uniswapV3?: UniswapV3Configuration;
  readonly uniswapV4?: UniswapV4Configuration;
  readonly logger?: ObservationCallback;
  readonly telemetry?: ObservationCallback;
}

export interface StorageConfiguration {
  /** sqlite:./path, sqlite://absolute/path, postgres:// or postgresql:// */
  readonly url?: string;
  readonly busyTimeoutMs?: number;
}

export interface SyncConfiguration { readonly reorgOverlapBlocks?: number; readonly maxWindowBlocks?: number; }
export interface ReplayConfiguration { readonly enabled?: boolean; readonly snapshotEveryEvents?: number; readonly snapshotEveryBlocks?: number; readonly leaseMs?: number; }
export interface NormalizedSyncConfiguration { readonly reorgOverlapBlocks: number; readonly maxWindowBlocks: number; }
export interface NormalizedReplayConfiguration { readonly enabled: boolean; readonly snapshotEveryEvents: number; readonly snapshotEveryBlocks: number; readonly leaseMs: number; }

export interface NormalizedStorageConfiguration {
  readonly driver: "sqlite" | "postgres";
  readonly url: string;
  readonly path?: string;
  readonly busyTimeoutMs: number;
}

export interface NormalizedClientConfiguration {
  readonly storage: NormalizedStorageConfiguration;
  readonly sync: NormalizedSyncConfiguration;
  readonly replay: NormalizedReplayConfiguration;
  readonly providers: readonly NormalizedProviderConfiguration[];
  readonly chains: readonly ChainDefinition[];
  readonly requestPolicy: NormalizedRequestPolicy;
  readonly proxies: readonly ProxyConfiguration[];
  readonly advancedProxy?: NormalizedSingBoxProxyConfiguration;
  readonly maxRangeRecords: number;
  readonly maxRangeWindows: number;
  readonly price?: NormalizedPriceConfiguration;
  readonly chainlink: NormalizedChainlinkConfiguration;
  readonly defi: NormalizedDeFiConfiguration;
  readonly uniswapV3: NormalizedUniswapV3Configuration;
  readonly uniswapV4: NormalizedUniswapV4Configuration;
  readonly logger?: ObservationCallback;
  readonly telemetry?: ObservationCallback;
}

const providerKeysSchema = z.array(z.string().trim().min(1).max(512)).min(1).max(64);
const providerBaseSchema = {
  apiKeys: providerKeysSchema,
  baseUrl: z.string().trim().min(1).max(2048).optional(),
  allowInsecureHttp: z.boolean().optional().default(false),
};
const providerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("etherscan"), ...providerBaseSchema }).strict(),
  z.object({ kind: z.literal("blockscout"), ...providerBaseSchema }).strict(),
  z.object({ kind: z.literal("alchemy"), ...providerBaseSchema }).strict(),
  z.object({ kind: z.literal("moralis"), ...providerBaseSchema }).strict(),
]);
const policySchema = z
  .object({
    attemptTimeoutMs: z.number().int().positive().max(86_400_000).default(DEFAULT_ATTEMPT_TIMEOUT_MS),
    totalTimeoutMs: z.number().int().positive().max(86_400_000).default(DEFAULT_TOTAL_TIMEOUT_MS),
    maxTotalAttempts: z.number().int().min(1).max(100).default(DEFAULT_MAX_TOTAL_ATTEMPTS),
    allowDirect: z.boolean().default(true),
    providerPacingMs: z
      .record(z.string().trim().min(1).max(128), z.number().int().min(0).max(86_400_000))
      .optional()
      .default({}),
  })
  .strict();
const proxySchema = z.object({ url: z.string().trim().min(1).max(2048) }).strict();
const singBoxRuntimeSchema = z.object({
  version: z.string().trim().min(1).max(32).default("1.13.16"),
  binaryPath: z.string().trim().min(1).max(4096).optional(),
  cacheDir: z.string().trim().min(1).max(4096).optional(),
  downloadMode: z.enum(["lazy", "eager"]).default("lazy"),
  startupTimeoutMs: z.number().int().positive().max(86_400_000).default(10_000),
}).strict();
const advancedProxySchema = z.object({
  kind: z.literal("sing-box"),
  urls: z.array(z.string().trim().min(1).max(8192)).min(1).max(32),
  singBox: singBoxRuntimeSchema.optional(),
}).strict();
const priceProviderSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("binance"), baseUrl: z.string().trim().min(1).max(2048).optional(), enabled: z.boolean().optional().default(true), allowInsecureHttp: z.boolean().optional().default(false) }).strict(),
  z.object({ kind: z.literal("okx"), baseUrl: z.string().trim().min(1).max(2048).optional(), enabled: z.boolean().optional().default(true), allowInsecureHttp: z.boolean().optional().default(false) }).strict(),
  z.object({ kind: z.literal("coinbase"), baseUrl: z.string().trim().min(1).max(2048).optional(), enabled: z.boolean().optional().default(true), allowInsecureHttp: z.boolean().optional().default(false) }).strict(),
  z.object({ kind: z.literal("geckoterminal"), baseUrl: z.string().trim().min(1).max(2048).optional(), enabled: z.boolean().optional().default(true), allowInsecureHttp: z.boolean().optional().default(false) }).strict(),
]);
const priceSchema = z.object({
  providers: z.array(priceProviderSchema).max(4).optional(),
  routeMode: z.enum(["direct", "proxy-only"]).default("direct"),
  attemptTimeoutMs: z.number().int().positive().max(86_400_000).default(DEFAULT_ATTEMPT_TIMEOUT_MS),
  totalTimeoutMs: z.number().int().positive().max(86_400_000).default(DEFAULT_TOTAL_TIMEOUT_MS),
  maxProviderConcurrency: z.number().int().min(1).max(4).default(4),
  tokenAliases: z.record(z.string().trim().min(1).max(128), z.string().trim().min(1).max(128)).optional().default({}),
  geckoNetworks: z.array(z.string().trim().min(1).max(128)).min(1).max(64).optional().default(["eth", "bsc", "polygon_pos", "arbitrum", "base", "optimism"]),
}).strict();
const archiveRpcEndpointSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    url: z.string().trim().min(1).max(8192),
    enabled: z.boolean().optional().default(true),
  })
  .strict();
const chainlinkSchema = z
  .object({
    enabled: z.boolean().optional().default(false),
    useBuiltinEthereumArchiveRpcs: z.boolean().optional(),
    rpcEndpoints: z.array(archiveRpcEndpointSchema).max(64).optional().default([]),
    healthCheckTimeoutMs: z.number().int().positive().max(86_400_000).default(DEFAULT_ATTEMPT_TIMEOUT_MS),
    attemptTimeoutMs: z.number().int().positive().max(86_400_000).default(DEFAULT_ATTEMPT_TIMEOUT_MS),
    totalTimeoutMs: z.number().int().positive().max(86_400_000).default(DEFAULT_TOTAL_TIMEOUT_MS),
    maxCallsPerMulticall: z.number().int().min(1).max(1000).default(100),
    maxRpcAttempts: z.number().int().min(1).max(20).default(5),
    maxConcurrentRpcAttempts: z.number().int().min(1).max(4).default(1),
  })
  .strict();
const defiSchema = z.object({
  enabled: z.boolean().optional().default(false),
  chains: z.array(z.enum(["ethereum", "base"])).min(1).max(2).optional(),
  useBuiltinArchiveRpcs: z.boolean().optional(),
  rpcEndpoints: z.object({
    ethereum: z.array(archiveRpcEndpointSchema).max(64).optional().default([]),
    base: z.array(archiveRpcEndpointSchema).max(64).optional().default([]),
  }).strict().optional().default({ ethereum: [], base: [] }),
  healthCheckTimeoutMs: z.number().int().positive().max(86_400_000).default(DEFAULT_ATTEMPT_TIMEOUT_MS),
  attemptTimeoutMs: z.number().int().positive().max(86_400_000).default(DEFAULT_ATTEMPT_TIMEOUT_MS),
  totalTimeoutMs: z.number().int().positive().max(86_400_000).default(DEFAULT_TOTAL_TIMEOUT_MS),
  maxCallsPerMulticall: z.number().int().min(1).max(1000).default(100),
  maxRpcAttempts: z.number().int().min(1).max(20).default(5),
  maxConcurrentRpcAttempts: z.number().int().min(1).max(4).default(1),
}).strict();
const uniswapV3Schema = z.object({
  enabled: z.boolean().optional().default(false),
  useBuiltinEthereumArchiveRpcs: z.boolean().optional(),
  rpcEndpoints: z.array(archiveRpcEndpointSchema).max(64).optional().default([]),
  healthCheckTimeoutMs: z.number().int().positive().max(86_400_000).default(DEFAULT_ATTEMPT_TIMEOUT_MS),
  attemptTimeoutMs: z.number().int().positive().max(86_400_000).default(DEFAULT_ATTEMPT_TIMEOUT_MS),
  totalTimeoutMs: z.number().int().positive().max(86_400_000).default(DEFAULT_TOTAL_TIMEOUT_MS),
  maxCallsPerMulticall: z.number().int().min(1).max(1000).default(100),
  maxRpcAttempts: z.number().int().min(1).max(20).default(5),
}).strict();
const uniswapV4Schema = uniswapV3Schema;
const clientShapeSchema = z
  .object({
    storage: z.object({ url: z.string().trim().min(1).max(4096).optional(), busyTimeoutMs: z.number().int().min(0).max(120000).optional() }).strict().optional(),
    sync: z.object({ reorgOverlapBlocks: z.number().int().min(0).max(100000).optional(), maxWindowBlocks: z.number().int().positive().max(10000000).optional() }).strict().optional(),
    replay: z.object({ enabled: z.boolean().optional(), snapshotEveryEvents: z.number().int().positive().max(10000000).optional(), snapshotEveryBlocks: z.number().int().positive().max(10000000).optional(), leaseMs: z.number().int().positive().max(86400000).optional() }).strict().optional(),
    providers: z.array(providerSchema).max(32).optional().default([]),
    price: priceSchema.optional(),
    chains: z.array(z.unknown()).max(256).optional().default([]),
    requestPolicy: policySchema.optional(),
    proxies: z.array(proxySchema).max(64).optional().default([]),
    advancedProxy: advancedProxySchema.optional(),
    maxRangeRecords: z.number().int().positive().max(10_000_000).default(DEFAULT_MAX_RANGE_RECORDS),
    maxRangeWindows: z.number().int().positive().max(1_000_000).default(DEFAULT_MAX_RANGE_WINDOWS),
    chainlink: chainlinkSchema.optional(),
    defi: defiSchema.optional(),
    uniswapV3: uniswapV3Schema.optional(),
    uniswapV4: uniswapV4Schema.optional(),
    logger: z.custom<ObservationCallback>((value) => typeof value === "function").optional(),
    telemetry: z.custom<ObservationCallback>((value) => typeof value === "function").optional(),
  })
  .strict();

export function parseClientConfiguration(input: unknown): NormalizedClientConfiguration {
  const parsed = clientShapeSchema.safeParse(input);
  if (!parsed.success) {
    throw invalidConfiguration("Invalid client configuration.");
  }

  const providers = parsed.data.providers.map((provider) => normalizeProvider(provider));
  const storage = normalizeStorageConfiguration(parsed.data.storage);
  const sync = Object.freeze({ reorgOverlapBlocks: parsed.data.sync?.reorgOverlapBlocks ?? 12, maxWindowBlocks: parsed.data.sync?.maxWindowBlocks ?? 100_000 });
  const replay = Object.freeze({ enabled: parsed.data.replay?.enabled ?? false, snapshotEveryEvents: parsed.data.replay?.snapshotEveryEvents ?? 10_000, snapshotEveryBlocks: parsed.data.replay?.snapshotEveryBlocks ?? 10_000, leaseMs: parsed.data.replay?.leaseMs ?? 60_000 });
  const chainlink = normalizeChainlinkConfiguration(
    parsed.data.chainlink ?? {
      enabled: false,
      rpcEndpoints: [],
      healthCheckTimeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
      attemptTimeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
      totalTimeoutMs: DEFAULT_TOTAL_TIMEOUT_MS,
      maxCallsPerMulticall: 100,
      maxRpcAttempts: 5,
      maxConcurrentRpcAttempts: 1,
    },
  );
  const defi = normalizeDeFiConfiguration(parsed.data.defi ?? { enabled: false, rpcEndpoints: { ethereum: [], base: [] }, healthCheckTimeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS, attemptTimeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS, totalTimeoutMs: DEFAULT_TOTAL_TIMEOUT_MS, maxCallsPerMulticall: 100, maxRpcAttempts: 5, maxConcurrentRpcAttempts: 1 });
  const uniswapV3 = normalizeUniswapV3Configuration(parsed.data.uniswapV3 ?? { enabled: false, rpcEndpoints: [], healthCheckTimeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS, attemptTimeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS, totalTimeoutMs: DEFAULT_TOTAL_TIMEOUT_MS, maxCallsPerMulticall: 100, maxRpcAttempts: 5 });
  const uniswapV4 = normalizeUniswapV3Configuration(parsed.data.uniswapV4 ?? { enabled: false, rpcEndpoints: [], healthCheckTimeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS, attemptTimeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS, totalTimeoutMs: DEFAULT_TOTAL_TIMEOUT_MS, maxCallsPerMulticall: 100, maxRpcAttempts: 5 });
  if (parsed.data.providers.length === 0 && parsed.data.price === undefined && !chainlink.enabled && !defi.enabled && !uniswapV3.enabled && !uniswapV4.enabled && parsed.data.storage === undefined) throw invalidConfiguration("Configure at least one blockchain or price provider, or enable Chainlink, DeFi, Uniswap, or storage.");
  const price = normalizePriceConfiguration(parsed.data.price ?? {
    routeMode: "direct",
    attemptTimeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
    totalTimeoutMs: DEFAULT_TOTAL_TIMEOUT_MS,
    maxProviderConcurrency: 4,
    tokenAliases: {},
    geckoNetworks: ["eth", "bsc", "polygon_pos", "arbitrum", "base", "optimism"],
  });
  if (providers.length === 0 && price.providers.length === 0 && !chainlink.enabled && !defi.enabled && !uniswapV3.enabled && !uniswapV4.enabled && parsed.data.storage === undefined) throw invalidConfiguration("Configure at least one blockchain or price provider, or enable Chainlink, DeFi, Uniswap, or storage.");
  const chains = parsed.data.chains.map((chain) => parseChainDefinition(chain));
  const requestPolicy = normalizeRequestPolicy(parsed.data.requestPolicy ?? {});
  const proxies = parsed.data.proxies.map((proxy) => normalizeProxy(proxy));
  const advancedProxy = parsed.data.advancedProxy === undefined
    ? undefined
    : normalizeAdvancedProxy(parsed.data.advancedProxy);

  const configuration: NormalizedClientConfiguration = {
    providers: Object.freeze(providers),
    storage,
    sync,
    replay,
    chains: Object.freeze(chains),
    requestPolicy,
    proxies: Object.freeze(proxies),
    ...(advancedProxy === undefined ? {} : { advancedProxy }),
    maxRangeRecords: parsed.data.maxRangeRecords,
    maxRangeWindows: parsed.data.maxRangeWindows,
    price,
    chainlink,
    defi,
    uniswapV3,
    uniswapV4,
    ...(parsed.data.logger === undefined ? {} : { logger: parsed.data.logger }),
    ...(parsed.data.telemetry === undefined ? {} : { telemetry: parsed.data.telemetry }),
  };

  return Object.freeze(configuration);
}

function normalizeStorageConfiguration(value: z.output<typeof clientShapeSchema>['storage']): NormalizedStorageConfiguration {
  const raw = value?.url ?? "sqlite:./data/evm-data-sdk.db";
  const busyTimeoutMs = value?.busyTimeoutMs ?? 5_000;
  if (raw.startsWith("postgres://") || raw.startsWith("postgresql://")) {
    try { new URL(raw); } catch { throw invalidConfiguration("storage.url must be a valid PostgreSQL URL."); }
    return Object.freeze({ driver: "postgres", url: raw, busyTimeoutMs });
  }
  let path: string;
  if (raw.startsWith("file:")) {
    try { path = decodeURIComponent(new URL(raw).pathname); } catch { throw invalidConfiguration("storage.url must be a valid SQLite file URL."); }
  } else if (raw.startsWith("sqlite:")) {
    const suffix = raw.slice("sqlite:".length);
    path = suffix.startsWith("//") ? decodeURIComponent(suffix.slice(1)) : suffix;
  } else path = raw;
  if (!path || path === ":memory:") path = ":memory:";
  return Object.freeze({ driver: "sqlite", url: `sqlite:${path}`, path, busyTimeoutMs });
}

function normalizeUniswapV3Configuration(value: z.output<typeof uniswapV3Schema>): NormalizedUniswapV3Configuration {
  if (value.totalTimeoutMs < value.attemptTimeoutMs) throw invalidConfiguration("uniswapV3.totalTimeoutMs must be at least uniswapV3.attemptTimeoutMs.");
  const useBuiltinEthereumArchiveRpcs = value.useBuiltinEthereumArchiveRpcs ?? value.enabled;
  const ids = new Set<string>(); const urls = new Set<string>();
  const rpcEndpoints = value.rpcEndpoints.map((endpoint) => {
    const id = endpoint.id.trim(); if (!id || ids.has(id)) throw invalidConfiguration("uniswapV3.rpcEndpoints ids must be unique and non-empty."); ids.add(id);
    let url: URL; try { url = new URL(endpoint.url); } catch { throw invalidConfiguration("uniswapV3.rpcEndpoints urls must be valid HTTPS URLs."); }
    if (url.protocol !== "https:" || urls.has(url.toString())) throw invalidConfiguration("uniswapV3.rpcEndpoints urls must be unique HTTPS URLs."); urls.add(url.toString());
    return Object.freeze({ id, url: endpoint.url.trim(), enabled: endpoint.enabled });
  });
  if (value.enabled && !useBuiltinEthereumArchiveRpcs && rpcEndpoints.every((endpoint) => !endpoint.enabled)) throw invalidConfiguration("uniswapV3 is enabled but no Archive RPC endpoint is configured.");
  return Object.freeze({ enabled: value.enabled, useBuiltinEthereumArchiveRpcs, rpcEndpoints: Object.freeze(rpcEndpoints), healthCheckTimeoutMs: value.healthCheckTimeoutMs, attemptTimeoutMs: value.attemptTimeoutMs, totalTimeoutMs: value.totalTimeoutMs, maxCallsPerMulticall: value.maxCallsPerMulticall, maxRpcAttempts: value.maxRpcAttempts });
}

function normalizeDeFiConfiguration(value: z.output<typeof defiSchema>): NormalizedDeFiConfiguration {
  if (value.totalTimeoutMs < value.attemptTimeoutMs) throw invalidConfiguration("defi.totalTimeoutMs must be at least defi.attemptTimeoutMs.");
  const chains = value.chains ?? ["ethereum", "base"];
  const useBuiltinArchiveRpcs = value.useBuiltinArchiveRpcs ?? value.enabled;
  if (new Set(chains).size !== chains.length) throw invalidConfiguration("defi.chains must not contain duplicates.");
  const normalizeEndpoints = (chain: "ethereum" | "base"): readonly NormalizedEthereumArchiveRpcEndpointConfiguration[] => {
    const ids = new Set<string>(); const urls = new Set<string>();
    return Object.freeze(value.rpcEndpoints[chain].map((endpoint) => {
      const id = endpoint.id.trim();
      if (ids.has(id)) throw invalidConfiguration(`defi.rpcEndpoints.${chain} ids must be unique.`);
      ids.add(id);
      let url: URL; try { url = new URL(endpoint.url); } catch { throw invalidConfiguration(`defi.rpcEndpoints.${chain} urls must be valid HTTPS URLs.`); }
      if (url.protocol !== "https:" || urls.has(url.toString())) throw invalidConfiguration(`defi.rpcEndpoints.${chain} urls must be unique HTTPS URLs.`);
      urls.add(url.toString());
      return Object.freeze({ id, url: endpoint.url.trim(), enabled: endpoint.enabled });
    }));
  };
  const rpcEndpoints = Object.freeze({ ethereum: normalizeEndpoints("ethereum"), base: normalizeEndpoints("base") });
  if (value.enabled && !useBuiltinArchiveRpcs) {
    for (const chain of chains) if (rpcEndpoints[chain].every((endpoint) => !endpoint.enabled)) throw invalidConfiguration(`defi is enabled for ${chain} but no Archive RPC endpoint is configured.`);
  }
  return Object.freeze({ enabled: value.enabled, chains: Object.freeze(chains), useBuiltinArchiveRpcs, rpcEndpoints, healthCheckTimeoutMs: value.healthCheckTimeoutMs, attemptTimeoutMs: value.attemptTimeoutMs, totalTimeoutMs: value.totalTimeoutMs, maxCallsPerMulticall: value.maxCallsPerMulticall, maxRpcAttempts: value.maxRpcAttempts, maxConcurrentRpcAttempts: value.maxConcurrentRpcAttempts });
}

function normalizeChainlinkConfiguration(
  value: z.output<typeof chainlinkSchema>,
): NormalizedChainlinkConfiguration {
  const enabled = value.enabled;
  const useBuiltinEthereumArchiveRpcs = value.useBuiltinEthereumArchiveRpcs ?? enabled;

  if (value.totalTimeoutMs < value.attemptTimeoutMs) {
    throw invalidConfiguration("chainlink.totalTimeoutMs must be at least chainlink.attemptTimeoutMs.");
  }

  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const rpcEndpoints = value.rpcEndpoints.map((endpoint) => {
    const id = endpoint.id.trim();
    if (id.length === 0 || seenIds.has(id)) {
      throw invalidConfiguration("chainlink.rpcEndpoints ids must be unique and non-empty.");
    }
    seenIds.add(id);

    let normalizedUrl: URL;
    try {
      normalizedUrl = new URL(endpoint.url);
    } catch {
      throw invalidConfiguration("chainlink.rpcEndpoints urls must be valid HTTPS URLs.");
    }
    if (normalizedUrl.protocol !== "https:") {
      throw invalidConfiguration("chainlink.rpcEndpoints urls must use HTTPS.");
    }
    const dedupeKey = normalizedUrl.toString();
    if (seenUrls.has(dedupeKey)) {
      throw invalidConfiguration("chainlink.rpcEndpoints urls must be unique.");
    }
    seenUrls.add(dedupeKey);

    return Object.freeze({
      id,
      url: endpoint.url.trim(),
      enabled: endpoint.enabled,
    });
  });

  if (enabled && !useBuiltinEthereumArchiveRpcs && rpcEndpoints.filter((endpoint) => endpoint.enabled).length === 0) {
    throw invalidConfiguration(
      "chainlink is enabled but no Archive RPC endpoint is configured: enable useBuiltinEthereumArchiveRpcs or supply rpcEndpoints.",
    );
  }

  return Object.freeze({
    enabled,
    useBuiltinEthereumArchiveRpcs,
    rpcEndpoints: Object.freeze(rpcEndpoints),
    healthCheckTimeoutMs: value.healthCheckTimeoutMs,
    attemptTimeoutMs: value.attemptTimeoutMs,
    totalTimeoutMs: value.totalTimeoutMs,
    maxCallsPerMulticall: value.maxCallsPerMulticall,
    maxRpcAttempts: value.maxRpcAttempts,
    maxConcurrentRpcAttempts: value.maxConcurrentRpcAttempts,
  });
}

function normalizeAdvancedProxy(
  value: z.output<typeof advancedProxySchema>,
): NormalizedSingBoxProxyConfiguration {
  const runtime = value.singBox ?? {
    version: "1.13.16",
    downloadMode: "lazy" as const,
    startupTimeoutMs: 10_000,
  };
  if (!/^\d+\.\d+\.\d+$/.test(runtime.version)) {
    throw invalidConfiguration("sing-box version must be a fixed semantic version.");
  }
  return Object.freeze({
    kind: "sing-box" as const,
    urls: Object.freeze(value.urls.map((url) => url.trim())),
    singBox: Object.freeze({
      version: runtime.version,
      ...(runtime.binaryPath === undefined ? {} : { binaryPath: runtime.binaryPath }),
      ...(runtime.cacheDir === undefined ? {} : { cacheDir: runtime.cacheDir }),
      downloadMode: runtime.downloadMode,
      startupTimeoutMs: runtime.startupTimeoutMs,
    }),
  });
}

function normalizePriceConfiguration(value: z.output<typeof priceSchema>): NormalizedPriceConfiguration {
  if (value.totalTimeoutMs < value.attemptTimeoutMs) {
    throw invalidConfiguration("price.totalTimeoutMs must be at least price.attemptTimeoutMs.");
  }
  const defaults: readonly TokenPriceProviderName[] = ["binance", "okx", "coinbase", "geckoterminal"];
  const defaultProviders: readonly {
    readonly kind: TokenPriceProviderName;
    readonly baseUrl?: string;
    readonly enabled: boolean;
    readonly allowInsecureHttp: boolean;
  }[] = defaults.map((kind) => ({ kind, enabled: true, allowInsecureHttp: false }));
  const selected = (value.providers ?? defaultProviders).filter((provider) => provider.enabled);
  const seen = new Set<string>();
  const providers = selected.map((provider) => {
    if (seen.has(provider.kind)) {
      throw invalidConfiguration("Price provider kinds must be unique.");
    }
    seen.add(provider.kind);
    const baseUrl = "baseUrl" in provider ? provider.baseUrl : undefined;
    if (baseUrl !== undefined) validateBaseUrl(baseUrl, provider.allowInsecureHttp);
    return Object.freeze({
      kind: provider.kind,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      allowInsecureHttp: provider.allowInsecureHttp,
    });
  });
  const aliases: Record<string, string> = {};
  for (const [input, output] of Object.entries(value.tokenAliases)) {
    const key = input.trim().toLowerCase();
    const symbol = output.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._-]{0,127}$/.test(symbol) || key in aliases) {
      throw invalidConfiguration("price.tokenAliases contains an invalid or duplicate alias.");
    }
    aliases[key] = symbol;
  }
  const networks = value.geckoNetworks.map((network) => network.trim().toLowerCase());
  if (new Set(networks).size !== networks.length) {
    throw invalidConfiguration("price.geckoNetworks must not contain duplicates.");
  }
  return Object.freeze({
    providers: Object.freeze(providers),
    routeMode: value.routeMode,
    attemptTimeoutMs: value.attemptTimeoutMs,
    totalTimeoutMs: value.totalTimeoutMs,
    maxProviderConcurrency: value.maxProviderConcurrency,
    tokenAliases: Object.freeze(aliases),
    geckoNetworks: Object.freeze(networks),
  });
}

function normalizeProvider(
  provider: z.output<typeof providerSchema>,
): NormalizedProviderConfiguration {
  if (provider.baseUrl !== undefined) {
    validateBaseUrl(provider.baseUrl, provider.allowInsecureHttp);
  }

  const common = {
    apiKeys: Object.freeze([...provider.apiKeys]),
    allowInsecureHttp: provider.allowInsecureHttp,
  };
  const baseUrl = provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl };

  if (provider.kind === "etherscan") {
    return Object.freeze({ kind: "etherscan", ...common, ...baseUrl });
  }
  if (provider.kind === "blockscout") {
    return Object.freeze({ kind: "blockscout", ...common, ...baseUrl });
  }
  if (provider.kind === "alchemy") {
    return Object.freeze({ kind: "alchemy", ...common, ...baseUrl });
  }
  return Object.freeze({ kind: "moralis", ...common, ...baseUrl });
}

function normalizeRequestPolicy(policyInput: unknown): NormalizedRequestPolicy {
  const parsed = policySchema.safeParse(policyInput);
  if (!parsed.success) {
    throw invalidConfiguration("Invalid request policy.");
  }
  const policy = parsed.data;
  if (policy.totalTimeoutMs < policy.attemptTimeoutMs) {
    throw invalidConfiguration("totalTimeoutMs must be at least attemptTimeoutMs.");
  }

  const providerPacingMs: Record<string, number> = {};
  for (const [provider, interval] of Object.entries(policy.providerPacingMs)) {
    const normalizedProvider = provider.trim().toLowerCase();
    if (normalizedProvider.length === 0 || normalizedProvider in providerPacingMs) {
      throw invalidConfiguration("providerPacingMs contains an invalid or duplicate provider name.");
    }
    providerPacingMs[normalizedProvider] = interval;
  }

  return Object.freeze({
    attemptTimeoutMs: policy.attemptTimeoutMs,
    totalTimeoutMs: policy.totalTimeoutMs,
    maxTotalAttempts: policy.maxTotalAttempts,
    allowDirect: policy.allowDirect,
    providerPacingMs: Object.freeze(providerPacingMs),
  });
}

function normalizeProxy(proxy: z.output<typeof proxySchema>): ProxyConfiguration {
  try {
    const parsed = new URL(proxy.url);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.hostname.length === 0 ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      throw new Error("unsupported protocol");
    }
    const port = parsed.port === "" ? (parsed.protocol === "https:" ? 443 : 80) : Number(parsed.port);
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error("invalid port");
    }
    if (parsed.username !== "") decodeURIComponent(parsed.username);
    if (parsed.password !== "") decodeURIComponent(parsed.password);
  } catch {
    throw invalidConfiguration("Proxy URL must be a valid HTTP(S) URL without a path, query, or fragment.");
  }

  return Object.freeze({ url: proxy.url });
}

function validateBaseUrl(value: string, allowInsecureHttp: boolean): void {
  try {
    const parsed = new URL(value);
    if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") {
      throw new Error("credentials or query not allowed");
    }
    if (parsed.protocol === "https:") {
      return;
    }
    if (parsed.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
    if (!allowInsecureHttp && !isLoopbackHost(parsed.hostname)) {
      throw new Error("insecure HTTP requires opt-in");
    }
  } catch {
    throw invalidConfiguration("Provider baseUrl must be a valid approved HTTP(S) URL.");
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

export function isBuiltinProviderName(value: string): value is BuiltinProviderName {
  return value === "etherscan" || value === "blockscout" || value === "alchemy" || value === "moralis";
}
