import fs from "node:fs";
import path from "node:path";

import type {
  ClientConfiguration,
  EthereumArchiveRpcEndpointConfiguration,
  ProviderConfiguration,
  ProxyConfiguration,
} from "../domain/configuration";

export interface EnvLoaderOptions {
  /**
   * Path to the environment file (e.g. .env, .env.key).
   * Defaults to '.env.key' or '.env' in current or parent working directories.
   */
  readonly filePath?: string | undefined;
  /**
   * Raw text content of environment variables.
   * If provided, overrides reading from filePath.
   */
  readonly content?: string | undefined;
  /**
   * Pre-parsed map of environment variables.
   */
  readonly envMap?: Readonly<Record<string, string>> | undefined;
  /**
   * Whether to fallback to process.env for missing keys.
   * Defaults to true.
   */
  readonly fallbackToProcessEnv?: boolean | undefined;
}

export type SupportedRpcChain = "ethereum" | "base" | "bsc" | "polygon" | "arbitrum" | "optimism";

/**
 * Parses raw .env file text into Key-Value pairs.
 * Correctly handles quotes, trims whitespace, and ignores comment lines.
 */
export function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.substring(0, eqIdx).trim();
    let val = trimmed.substring(eqIdx + 1).trim();

    // Remove quotes if present
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.substring(1, val.length - 1);
    }

    if (key) {
      result[key] = val;
    }
  }

  return result;
}

export class EnvLoader {
  private readonly envMap: Record<string, string>;
  private readonly fallbackToProcessEnv: boolean;

  constructor(options: EnvLoaderOptions = {}) {
    this.fallbackToProcessEnv = options.fallbackToProcessEnv ?? true;

    if (options.envMap !== undefined) {
      this.envMap = { ...options.envMap };
    } else if (options.content !== undefined) {
      this.envMap = parseEnvContent(options.content);
    } else {
      const targetPath = options.filePath ?? this.findDefaultEnvFile();
      if (targetPath && fs.existsSync(targetPath)) {
        const fileContent = fs.readFileSync(targetPath, "utf-8");
        this.envMap = parseEnvContent(fileContent);
      } else {
        this.envMap = {};
      }
    }
  }

  /**
   * Find default env file (.env.key or .env) searching current and parent directories.
   */
  private findDefaultEnvFile(): string | undefined {
    let currentDir = process.cwd();
    while (true) {
      const keyPath = path.join(currentDir, ".env.key");
      if (fs.existsSync(keyPath)) return keyPath;

      const envPath = path.join(currentDir, ".env");
      if (fs.existsSync(envPath)) return envPath;

      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }
    return undefined;
  }

  private findLocalSingBoxBinary(): string | undefined {
    const candidates = [
      path.join(process.cwd(), "examples/sing-box-prewarm/.verified-sing-box/1.13.16/linux-x64/sing-box"),
      path.join(process.cwd(), ".verified-sing-box/1.13.16/linux-x64/sing-box"),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return undefined;
  }

  /**
   * Get value of an environment key with optional fallback to process.env.
   */
  get(key: string): string | undefined {
    const direct = this.envMap[key];
    if (direct !== undefined && direct !== "") return direct;
    if (this.fallbackToProcessEnv && typeof process !== "undefined" && process.env) {
      return process.env[key];
    }
    return undefined;
  }

  /**
   * Get all environment keys matching a specific prefix (e.g. "ETHERSCAN_API_KEY", "NODEREAL_RPC_API_KEY").
   * Values are deduplicated and returned in natural sorted order by key name.
   */
  /**
   * Get all environment keys matching a specific prefix with their env variable names.
   */
  getKeyEntriesByPrefix(prefix: string): { name: string; value: string }[] {
    const uppercasePrefix = prefix.toUpperCase();
    const result: { name: string; value: string }[] = [];
    const seenValues = new Set<string>();

    const sortedEntries = Object.entries(this.envMap)
      .filter(([k]) => k.toUpperCase().startsWith(uppercasePrefix))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

    for (const [name, val] of sortedEntries) {
      if (val && !seenValues.has(val)) {
        seenValues.add(val);
        result.push({ name, value: val });
      }
    }

    if (result.length === 0 && this.fallbackToProcessEnv && typeof process !== "undefined" && process.env) {
      const processEntries = Object.entries(process.env)
        .filter(([k, v]) => k.toUpperCase().startsWith(uppercasePrefix) && !!v)
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

      for (const [name, val] of processEntries) {
        if (val && !seenValues.has(val)) {
          seenValues.add(val);
          result.push({ name, value: val! });
        }
      }
    }

    return result;
  }

  getKeysByPrefix(prefix: string): string[] {
    const uppercasePrefix = prefix.toUpperCase();
    const result: string[] = [];

    const sortedEntries = Object.entries(this.envMap)
      .filter(([k]) => k.toUpperCase().startsWith(uppercasePrefix))
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

    for (const [_, val] of sortedEntries) {
      if (val && !result.includes(val)) {
        result.push(val);
      }
    }

    if (result.length === 0 && this.fallbackToProcessEnv && typeof process !== "undefined" && process.env) {
      const processEntries = Object.entries(process.env)
        .filter(([k, v]) => k.toUpperCase().startsWith(uppercasePrefix) && !!v)
        .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

      for (const [_, val] of processEntries) {
        if (val && !result.includes(val)) {
          result.push(val!);
        }
      }
    }

    return result;
  }

  /**
   * Get entries matching a RegExp pattern against key names.
   */
  getKeysByPattern(pattern: RegExp): { name: string; value: string }[] {
    const entriesMap = new Map<string, string>();

    for (const [k, v] of Object.entries(this.envMap)) {
      if (pattern.test(k) && v) {
        entriesMap.set(k, v);
      }
    }

    if (entriesMap.size === 0 && this.fallbackToProcessEnv && typeof process !== "undefined" && process.env) {
      for (const [k, v] of Object.entries(process.env)) {
        if (pattern.test(k) && v) {
          entriesMap.set(k, v);
        }
      }
    }

    return Array.from(entriesMap.entries())
      .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
      .map(([name, value]) => ({ name, value }));
  }

  /**
   * Dynamically build SDK provider configurations for indexed data providers.
   */
  getProviderConfig(
    kind: "etherscan" | "blockscout" | "alchemy" | "moralis",
    prefix?: string,
  ): ProviderConfiguration | null {
    const defaultPrefixMap: Record<"etherscan" | "blockscout" | "alchemy" | "moralis", string> = {
      etherscan: "ETHERSCAN_API_KEY",
      blockscout: "BLOCKSCOUT_API_KEY",
      alchemy: "ALCHEMY_API_KEY",
      moralis: "MORALIS_API_KEY",
    };

    const targetPrefix = prefix ?? defaultPrefixMap[kind];
    const keyEntries = this.getKeyEntriesByPrefix(targetPrefix);
    if (keyEntries.length === 0) return null;

    return {
      kind,
      apiKeys: keyEntries.map((e) => e.value),
      envKeyNames: keyEntries.map((e) => e.name),
    };
  }

  /**
   * Returns all provider configurations found in environment variables.
   */
  getProviderConfigs(): readonly ProviderConfiguration[] {
    const kinds = ["etherscan", "blockscout", "alchemy", "moralis"] as const;
    const configs: ProviderConfiguration[] = [];

    for (const kind of kinds) {
      const config = this.getProviderConfig(kind);
      if (config !== null) {
        configs.push(config);
      }
    }

    return Object.freeze(configs);
  }

  /**
   * Extracts multi-chain RPC endpoints for a specific chain.
   * Supports NodeReal MegaNode, Ankr, Alchemy, DRPC, Infura, and direct RPC URLs.
   */
  getRpcEndpoints(chain: SupportedRpcChain): readonly EthereumArchiveRpcEndpointConfiguration[] {
    const endpoints: EthereumArchiveRpcEndpointConfiguration[] = [];
    const seenUrls = new Set<string>();

    const addEndpoint = (id: string, url: string, envKeyName?: string) => {
      if (!url || seenUrls.has(url)) return;
      seenUrls.add(url);
      endpoints.push(Object.freeze({
        id,
        url,
        enabled: true,
        ...(envKeyName !== undefined ? { envKeyName } : {}),
      }));
    };

    // 1. NodeReal (MegaNode) - multi-chain support with 1 key
    const nodeRealKeys = this.getKeysByPattern(/^(?:NODEREAL|MEGANODE)(?:_RPC)?(?:_API)?_KEY(?:_?\d+)?$/i);
    nodeRealKeys.forEach(({ name: envKeyName, value: key }, idx) => {
      const id = `nodereal-${chain}-${idx + 1}`;
      switch (chain) {
        case "ethereum":
          addEndpoint(id, `https://eth-mainnet.nodereal.io/v1/${key}`, envKeyName);
          break;
        case "base":
          addEndpoint(id, `https://open-platform.nodereal.io/${key}/base`, envKeyName);
          break;
        case "bsc":
          addEndpoint(id, `https://bsc-mainnet.nodereal.io/v1/${key}`, envKeyName);
          break;
        case "polygon":
          addEndpoint(id, `https://polygon-mainnet.nodereal.io/v1/${key}`, envKeyName);
          break;
        case "arbitrum":
          addEndpoint(id, `https://open-platform.nodereal.io/${key}/arbitrum-nitro/`, envKeyName);
          break;
        case "optimism":
          addEndpoint(id, `https://opt-mainnet.nodereal.io/v1/${key}`, envKeyName);
          break;
      }
    });

    // 2. Ankr - multi-chain support with 1 key
    const ankrKeys = this.getKeysByPattern(/^ANKR(?:_RPC)?(?:_API)?_KEY(?:_?\d+)?$/i);
    ankrKeys.forEach(({ name: envKeyName, value: key }, idx) => {
      const id = `ankr-${chain}-${idx + 1}`;
      switch (chain) {
        case "ethereum":
          addEndpoint(id, `https://rpc.ankr.com/eth/${key}`, envKeyName);
          break;
        case "base":
          addEndpoint(id, `https://rpc.ankr.com/base/${key}`, envKeyName);
          break;
        case "bsc":
          addEndpoint(id, `https://rpc.ankr.com/bsc/${key}`, envKeyName);
          break;
        case "polygon":
          addEndpoint(id, `https://rpc.ankr.com/polygon/${key}`, envKeyName);
          break;
        case "arbitrum":
          addEndpoint(id, `https://rpc.ankr.com/arbitrum/${key}`, envKeyName);
          break;
        case "optimism":
          addEndpoint(id, `https://rpc.ankr.com/optimism/${key}`, envKeyName);
          break;
      }
    });

    // 3. Alchemy RPC - multi-chain support with 1 key
    const alchemyKeys = this.getKeysByPattern(/^ALCHEMY(?:_RPC)?(?:_API)?_KEY(?:_?\d+)?$/i);
    alchemyKeys.forEach(({ name: envKeyName, value: key }, idx) => {
      const id = `alchemy-${chain}-${idx + 1}`;
      switch (chain) {
        case "ethereum":
          addEndpoint(id, `https://eth-mainnet.g.alchemy.com/v2/${key}`, envKeyName);
          break;
        case "base":
          addEndpoint(id, `https://base-mainnet.g.alchemy.com/v2/${key}`, envKeyName);
          break;
        case "bsc":
          addEndpoint(id, `https://bnb-mainnet.g.alchemy.com/v2/${key}`, envKeyName);
          break;
        case "polygon":
          addEndpoint(id, `https://polygon-mainnet.g.alchemy.com/v2/${key}`, envKeyName);
          break;
        case "arbitrum":
          addEndpoint(id, `https://arb-mainnet.g.alchemy.com/v2/${key}`, envKeyName);
          break;
        case "optimism":
          addEndpoint(id, `https://opt-mainnet.g.alchemy.com/v2/${key}`, envKeyName);
          break;
      }
    });

    // 4. DRPC - multi-chain support with 1 key
    const drpcKeys = this.getKeysByPattern(/^DRPC(?:_RPC)?(?:_API)?_KEY(?:_?\d+)?$/i);
    drpcKeys.forEach(({ name: envKeyName, value: key }, idx) => {
      const id = `drpc-${chain}-${idx + 1}`;
      switch (chain) {
        case "ethereum":
          addEndpoint(id, `https://lb.drpc.org/ogrpc?network=ethereum&dkey=${key}`, envKeyName);
          break;
        case "base":
          addEndpoint(id, `https://lb.drpc.org/ogrpc?network=base&dkey=${key}`, envKeyName);
          break;
        case "bsc":
          addEndpoint(id, `https://lb.drpc.org/ogrpc?network=bsc&dkey=${key}`, envKeyName);
          break;
        case "polygon":
          addEndpoint(id, `https://lb.drpc.org/ogrpc?network=polygon&dkey=${key}`, envKeyName);
          break;
        case "arbitrum":
          addEndpoint(id, `https://lb.drpc.org/ogrpc?network=arbitrum&dkey=${key}`, envKeyName);
          break;
        case "optimism":
          addEndpoint(id, `https://lb.drpc.org/ogrpc?network=optimism&dkey=${key}`, envKeyName);
          break;
      }
    });

    // 5. Infura - multi-chain support
    const infuraKeys = this.getKeysByPattern(/^INFURA(?:_RPC)?(?:_API)?_KEY(?:_?\d+)?$/i);
    infuraKeys.forEach(({ name: envKeyName, value: key }, idx) => {
      const id = `infura-${chain}-${idx + 1}`;
      switch (chain) {
        case "ethereum":
          addEndpoint(id, `https://mainnet.infura.io/v3/${key}`, envKeyName);
          break;
        case "base":
          addEndpoint(id, `https://base-mainnet.infura.io/v3/${key}`, envKeyName);
          break;
        case "polygon":
          addEndpoint(id, `https://polygon-mainnet.infura.io/v3/${key}`, envKeyName);
          break;
        case "arbitrum":
          addEndpoint(id, `https://arbitrum-mainnet.infura.io/v3/${key}`, envKeyName);
          break;
        case "optimism":
          addEndpoint(id, `https://optimism-mainnet.infura.io/v3/${key}`, envKeyName);
          break;
      }
    });

    // 6. Direct RPC URLs configured in environment
    const directPatternMap: Record<SupportedRpcChain, RegExp> = {
      ethereum: /^(?:ETHEREUM|ETH|CHAINLINK)(?:_ARCHIVE)?_RPC_URL(?:_?\d+)?$/i,
      base: /^BASE(?:_ARCHIVE)?_RPC_URL(?:_?\d+)?$/i,
      bsc: /^(?:BSC|BNB)(?:_ARCHIVE)?_RPC_URL(?:_?\d+)?$/i,
      polygon: /^POLYGON(?:_ARCHIVE)?_RPC_URL(?:_?\d+)?$/i,
      arbitrum: /^(?:ARBITRUM|ARB)(?:_ARCHIVE)?_RPC_URL(?:_?\d+)?$/i,
      optimism: /^(?:OPTIMISM|OP)(?:_ARCHIVE)?_RPC_URL(?:_?\d+)?$/i,
    };

    const directUrls = this.getKeysByPattern(directPatternMap[chain]);
    directUrls.forEach(({ name: envKeyName, value: url }, idx) => {
      addEndpoint(`custom-${chain}-${idx + 1}`, url, envKeyName);
    });

    return Object.freeze(endpoints);
  }

  /**
   * Returns all RPC endpoints grouped by chain name.
   */
  getAllRpcEndpoints(): Readonly<Record<SupportedRpcChain, readonly EthereumArchiveRpcEndpointConfiguration[]>> {
    const chains: readonly SupportedRpcChain[] = ["ethereum", "base", "bsc", "polygon", "arbitrum", "optimism"];
    const result = {} as Record<SupportedRpcChain, readonly EthereumArchiveRpcEndpointConfiguration[]>;

    for (const chain of chains) {
      result[chain] = this.getRpcEndpoints(chain);
    }

    return Object.freeze(result);
  }

  /**
   * Parses proxy URLs from HTTP_PROXY, HTTPS_PROXY, or PROXY_URL(s).
   */
  getProxies(): readonly ProxyConfiguration[] {
    const proxies: ProxyConfiguration[] = [];
    const proxyUrls = this.getKeysByPattern(/^(?:HTTP_PROXY|HTTPS_PROXY|PROXY_URL(?:_?\d+)?)$/i);

    const seen = new Set<string>();
    for (const { value: rawUrl } of proxyUrls) {
      if (!rawUrl || rawUrl.includes("example.com")) continue;
      // If it's a proxy protocol that belongs to Sing-box, skip here
      if (/^(?:vless|vmess|ss|trojan|hysteria|hysteria2|tuic):\/\//i.test(rawUrl)) {
        continue;
      }
      try {
        const parsed = new URL(rawUrl);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
        if (parsed.search !== "" || parsed.hash !== "") continue;
        // Normalize URL to omit trailing slash if pathname is empty or /
        if (parsed.pathname !== "" && parsed.pathname !== "/") continue;
        const portStr = parsed.port ? `:${parsed.port}` : "";
        const auth = parsed.username ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ""}@` : "";
        const cleanUrl = `${parsed.protocol}//${auth}${parsed.hostname}${portStr}`;
        if (!seen.has(cleanUrl)) {
          seen.add(cleanUrl);
          proxies.push(Object.freeze({ url: cleanUrl }));
        }
      } catch {
        // Skip invalid URL
      }
    }

    return Object.freeze(proxies);
  }

  /**
   * Parses sing-box URLs from SING_BOX_URL(s), VLESS_URL(s), or proxy URLs with node protocol schemes.
   */
  getSingBoxUrls(): readonly string[] {
    const singBoxPattern = /^(?:SING_BOX|VLESS|VMESS|TROJAN|SHADOWSOCKS|SS|EVM_DATA_SDK_VLESS)(?:_SUBSCRIPTION)?_URL(?:_?\d+)?$/i;
    const directPattern = this.getKeysByPattern(singBoxPattern);
    const proxyUrls = this.getKeysByPattern(/^PROXY_URL(?:_?\d+)?$/i);

    const seen = new Set<string>();
    const urls: string[] = [];

    const addUrl = (url: string) => {
      if (url && !seen.has(url) && !url.includes("example.com") && !url.includes("11111111-1111-1111-1111-111111111111")) {
        seen.add(url);
        urls.push(url);
      }
    };

    for (const { value: url } of directPattern) {
      addUrl(url);
    }

    for (const { value: url } of proxyUrls) {
      if (/^(?:vless|vmess|ss|trojan|hysteria|hysteria2|tuic):\/\//i.test(url)) {
        addUrl(url);
      }
    }

    return Object.freeze(urls);
  }

  /**
   * Reads storage URL from DATABASE_URL, STORAGE_URL, or SQLITE_PATH.
   */
  getStorageUrl(): string | undefined {
    return this.get("DATABASE_URL") ?? this.get("STORAGE_URL") ?? this.get("SQLITE_PATH");
  }

  /**
   * Constructs a full ClientConfiguration from parsed environment variables,
   * cleanly merging with optional overrides.
   */
  toClientConfiguration(overrides: Partial<ClientConfiguration> = {}): ClientConfiguration {
    const providers = overrides.providers ?? this.getProviderConfigs();
    const ethRpcEndpoints = this.getRpcEndpoints("ethereum");
    const baseRpcEndpoints = this.getRpcEndpoints("base");

    const proxies = overrides.proxies ?? (this.getProxies().length > 0 ? this.getProxies() : undefined);
    const singBoxUrls = this.getSingBoxUrls();
    const binaryPath = this.get("SING_BOX_BINARY_PATH") ?? this.findLocalSingBoxBinary();
    const advancedProxy =
      overrides.advancedProxy !== undefined
        ? overrides.advancedProxy
        : (singBoxUrls.length > 0
            ? {
                kind: "sing-box" as const,
                urls: singBoxUrls,
                ...(binaryPath ? { singBox: { binaryPath } } : {}),
              }
            : undefined);

    const storageUrl = this.getStorageUrl();
    const storage = overrides.storage ?? (storageUrl ? { url: storageUrl } : undefined);

    const slackWebhookUrl = this.get("SLACK_WEBHOOK_URL") ?? this.get("ALERT_SLACK_WEBHOOK");
    const alert = overrides.alert ?? (slackWebhookUrl ? { enabled: true, slackWebhookUrl } : undefined);

    // Merge Chainlink RPC endpoints
    let chainlink = overrides.chainlink;
    if (chainlink) {
      const mergedRpc = mergeEndpoints(chainlink.rpcEndpoints ?? [], ethRpcEndpoints);
      chainlink = { ...chainlink, rpcEndpoints: mergedRpc };
    }

    // Merge DeFi RPC endpoints
    let defi = overrides.defi;
    if (defi) {
      const mergedEth = mergeEndpoints(defi.rpcEndpoints?.ethereum ?? [], ethRpcEndpoints);
      const mergedBase = mergeEndpoints(defi.rpcEndpoints?.base ?? [], baseRpcEndpoints);
      defi = {
        ...defi,
        rpcEndpoints: {
          ethereum: mergedEth,
          base: mergedBase,
        },
      };
    }

    // Merge Uniswap V3 RPC endpoints
    let uniswapV3 = overrides.uniswapV3;
    if (uniswapV3) {
      const mergedRpc = mergeEndpoints(uniswapV3.rpcEndpoints ?? [], ethRpcEndpoints);
      uniswapV3 = { ...uniswapV3, rpcEndpoints: mergedRpc };
    }

    // Merge Uniswap V4 RPC endpoints
    let uniswapV4 = overrides.uniswapV4;
    if (uniswapV4) {
      const mergedRpc = mergeEndpoints(uniswapV4.rpcEndpoints ?? [], ethRpcEndpoints);
      uniswapV4 = { ...uniswapV4, rpcEndpoints: mergedRpc };
    }

    return {
      ...overrides,
      ...(providers.length > 0 ? { providers } : {}),
      ...(proxies ? { proxies } : {}),
      ...(advancedProxy ? { advancedProxy } : {}),
      ...(storage ? { storage } : {}),
      ...(chainlink ? { chainlink } : {}),
      ...(defi ? { defi } : {}),
      ...(uniswapV3 ? { uniswapV3 } : {}),
      ...(uniswapV4 ? { uniswapV4 } : {}),
      ...(alert ? { alert } : {}),
    };
  }
}

function mergeEndpoints(
  explicit: readonly EthereumArchiveRpcEndpointConfiguration[],
  discovered: readonly EthereumArchiveRpcEndpointConfiguration[],
): readonly EthereumArchiveRpcEndpointConfiguration[] {
  const ids = new Set<string>();
  const urls = new Set<string>();
  const result: EthereumArchiveRpcEndpointConfiguration[] = [];

  for (const ep of explicit) {
    ids.add(ep.id);
    urls.add(ep.url);
    result.push(ep);
  }

  for (const ep of discovered) {
    if (!ids.has(ep.id) && !urls.has(ep.url)) {
      ids.add(ep.id);
      urls.add(ep.url);
      result.push(ep);
    }
  }

  return Object.freeze(result);
}

/**
 * Convenience helper to load a full ClientConfiguration from an env file or environment.
 */
export function loadClientConfigurationFromEnv(
  options: EnvLoaderOptions & { overrides?: Partial<ClientConfiguration> } = {},
): ClientConfiguration {
  const loader = new EnvLoader(options);
  return loader.toClientConfiguration(options.overrides);
}
