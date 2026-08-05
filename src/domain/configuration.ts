import { z } from "zod";

import type { ChainDefinition, BuiltinProviderName } from "./chains";
import { parseChainDefinition } from "./chains";
import { invalidConfiguration } from "./errors";
import type { OperationName } from "./operations";
import type { TokenPriceProviderName } from "./priceModels";

export const DEFAULT_ATTEMPT_TIMEOUT_MS = 10_000;
export const DEFAULT_TOTAL_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_TOTAL_ATTEMPTS = 6;

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

export interface AlchemyConfiguration extends ProviderConfigurationBase {
  readonly kind: "alchemy";
}

export interface MoralisConfiguration extends ProviderConfigurationBase {
  readonly kind: "moralis";
}

export type ProviderConfiguration =
  | EtherscanConfiguration
  | AlchemyConfiguration
  | MoralisConfiguration;

interface NormalizedEtherscanConfiguration extends NormalizedProviderConfigurationBase {
  readonly kind: "etherscan";
}

interface NormalizedAlchemyConfiguration extends NormalizedProviderConfigurationBase {
  readonly kind: "alchemy";
}

interface NormalizedMoralisConfiguration extends NormalizedProviderConfigurationBase {
  readonly kind: "moralis";
}

type NormalizedProviderConfiguration =
  | NormalizedEtherscanConfiguration
  | NormalizedAlchemyConfiguration
  | NormalizedMoralisConfiguration;

export interface ClientConfiguration {
  readonly providers?: readonly ProviderConfiguration[];
  readonly price?: PriceConfiguration;
  readonly chains?: readonly ChainDefinition[];
  readonly requestPolicy?: RequestPolicy;
  readonly proxies?: readonly ProxyConfiguration[];
  readonly logger?: ObservationCallback;
  readonly telemetry?: ObservationCallback;
}

export interface NormalizedClientConfiguration {
  readonly providers: readonly NormalizedProviderConfiguration[];
  readonly chains: readonly ChainDefinition[];
  readonly requestPolicy: NormalizedRequestPolicy;
  readonly proxies: readonly ProxyConfiguration[];
  readonly price?: NormalizedPriceConfiguration;
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
const clientShapeSchema = z
  .object({
    providers: z.array(providerSchema).max(32).optional().default([]),
    price: priceSchema.optional(),
    chains: z.array(z.unknown()).max(256).optional().default([]),
    requestPolicy: policySchema.optional(),
    proxies: z.array(proxySchema).max(64).optional().default([]),
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
  if (parsed.data.providers.length === 0 && parsed.data.price === undefined) {
    throw invalidConfiguration("Configure at least one blockchain or price provider.");
  }
  const price = normalizePriceConfiguration(parsed.data.price ?? {
    routeMode: "direct",
    attemptTimeoutMs: DEFAULT_ATTEMPT_TIMEOUT_MS,
    totalTimeoutMs: DEFAULT_TOTAL_TIMEOUT_MS,
    maxProviderConcurrency: 4,
    tokenAliases: {},
    geckoNetworks: ["eth", "bsc", "polygon_pos", "arbitrum", "base", "optimism"],
  });
  if (providers.length === 0 && price.providers.length === 0) {
    throw invalidConfiguration("Configure at least one blockchain or price provider.");
  }
  const chains = parsed.data.chains.map((chain) => parseChainDefinition(chain));
  const requestPolicy = normalizeRequestPolicy(parsed.data.requestPolicy ?? {});
  const proxies = parsed.data.proxies.map((proxy) => normalizeProxy(proxy));

  const configuration: NormalizedClientConfiguration = {
    providers: Object.freeze(providers),
    chains: Object.freeze(chains),
    requestPolicy,
    proxies: Object.freeze(proxies),
    price,
    ...(parsed.data.logger === undefined ? {} : { logger: parsed.data.logger }),
    ...(parsed.data.telemetry === undefined ? {} : { telemetry: parsed.data.telemetry }),
  };

  return Object.freeze(configuration);
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
  return value === "etherscan" || value === "alchemy" || value === "moralis";
}
