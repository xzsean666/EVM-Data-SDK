import type { ClientConfiguration, NormalizedClientConfiguration } from "../domain/configuration";
import { parseClientConfiguration } from "../domain/configuration";
import { invalidConfiguration } from "../domain/errors";
import { ChainRegistry } from "../chains/ChainRegistry";
import { CredentialPool } from "../execution/CredentialPool";
import { ProviderRouter } from "../execution/ProviderRouter";
import { ProxyPool } from "../execution/ProxyPool";
import { RequestExecutor } from "../execution/RequestExecutor";
import { BlockRangeScanner } from "../execution/BlockRangeScanner";
import type { RandomSource } from "../execution/clock";
import { systemRandom } from "../execution/clock";
import { AddressService } from "../services/AddressService";
import { ApiChainService } from '../services/ApiChainService';
import { TokenService } from "../services/TokenService";
import { EtherscanAdapter } from "../providers/etherscan/EtherscanAdapter";
import { BlockscoutAdapter } from "../providers/blockscout/BlockscoutAdapter";
import { AlchemyAdapter } from "../providers/alchemy/AlchemyAdapter";
import { MoralisAdapter } from "../providers/moralis/MoralisAdapter";
import type { DataProviderAdapter } from "../providers/DataProviderAdapter";
import { BinanceAdapter } from "../providers/price/binance/BinanceAdapter";
import { CoinbaseAdapter } from "../providers/price/coinbase/CoinbaseAdapter";
import { GeckoTerminalAdapter } from "../providers/price/geckoterminal/GeckoTerminalAdapter";
import { OkxAdapter } from "../providers/price/okx/OkxAdapter";
import { PriceProviderRouter } from "../price/PriceProviderRouter";
import { PriceRequestExecutor } from "../price/PriceRequestExecutor";
import { TokenPriceAggregator } from "../price/TokenPriceAggregator";
import type { TokenPriceProviderAdapter } from "../price/TokenPriceProviderAdapter";
import type { HttpTransport } from "../transport/HttpTransport";
import { SingBoxProxyManager } from "../proxy/SingBoxProxyManager";
import { BUILTIN_ETHEREUM_ARCHIVE_RPCS } from "../rpc/builtinEthereumArchiveRpcs";
import { BUILTIN_BASE_ARCHIVE_RPCS } from "../rpc/builtinBaseArchiveRpcs";
import { EthereumArchiveRpcPool, type EthereumArchiveRpcEndpoint } from "../rpc/EthereumArchiveRpcPool";
import { EthereumArchiveRpcExecutor } from "../rpc/EthereumArchiveRpcExecutor";
import { RpcService } from "../rpc/RpcService";
import { ChainlinkService } from "../chainlink/ChainlinkService";
import { DeFiExchangeRateService } from "../defi/DeFiExchangeRateService";
import { MULTICALL3_ADDRESS, MULTICALL3_BASE_MAINNET_DEPLOYMENT_BLOCK, MULTICALL3_ETHEREUM_MAINNET_DEPLOYMENT_BLOCK } from "../rpc/EthereumMulticall3Codec";
import { UniswapV3HistoricalPriceService } from "../defi/UniswapV3HistoricalPriceService";

export interface EvmDataClientOptions {
  readonly transport?: HttpTransport;
  readonly adapters?: Partial<Record<"etherscan" | "blockscout" | "alchemy" | "moralis", DataProviderAdapter>>;
  readonly priceAdapters?: Partial<Record<"binance" | "okx" | "coinbase" | "geckoterminal", TokenPriceProviderAdapter>>;
  /** Test seam for the optional managed proxy; it never changes public configuration. */
  readonly advancedProxyManager?: SingBoxProxyManager;
  /** Test seam for deterministic Archive RPC endpoint selection; defaults to `systemRandom`. */
  readonly archiveRpcRandomSource?: RandomSource;
  /** Test seam for the Archive RPC pool used by `chainlink`/`rpc`. */
  readonly archiveRpcPool?: EthereumArchiveRpcPool;
  /** Test seams for DeFi chain-specific Archive RPC pools. */
  readonly defiArchiveRpcPools?: Partial<Record<"ethereum" | "base", EthereumArchiveRpcPool>>;
  /** Test seam for the opt-in Uniswap V3 Ethereum Archive RPC pool. */
  readonly uniswapV3ArchiveRpcPool?: EthereumArchiveRpcPool;
}

export class EvmDataClient {
  readonly address: AddressService;
  readonly chain: ApiChainService;
  readonly token: TokenService;
  readonly rpc: RpcService | null;
  readonly chainlink: ChainlinkService | null;
  readonly defi: DeFiExchangeRateService | null;
  readonly uniswapV3: UniswapV3HistoricalPriceService | null;

  private readonly configuration: NormalizedClientConfiguration;
  private readonly advancedProxyManager: SingBoxProxyManager | null;
  private readonly archiveRpcPool: EthereumArchiveRpcPool | null;
  private readonly defiArchiveRpcPools: readonly EthereumArchiveRpcPool[];
  private readonly uniswapV3ArchiveRpcPool: EthereumArchiveRpcPool | null;
  /**
   * Per-chain Archive RPC executors, keyed by chain, reused to serve
   * `getBlockNumberByTimestamp` via pure public RPC binary search. Populated
   * only for chains where `defi` is enabled (the same executors already
   * built for DeFi exchange-rate reads); there is no separate pool.
   */
  private readonly chainRpcExecutors = new Map<"ethereum" | "base", EthereumArchiveRpcExecutor>();

  constructor(configuration: ClientConfiguration, options: EvmDataClientOptions = {}) {
    this.configuration = parseClientConfiguration(configuration);
    const registry = new ChainRegistry(this.configuration.chains);
    const entries = this.configuration.providers.map((provider, index) => {
      const configurationId = `${provider.kind}-${index + 1}`;
      let adapter: DataProviderAdapter;
      try {
        adapter = options.adapters?.[provider.kind] ?? createAdapter(provider.kind, provider.baseUrl, provider.allowInsecureHttp, options.transport);
      } catch (error: unknown) {
        throw invalidConfiguration(`Invalid ${provider.kind} provider configuration.`, error);
      }
      return { configurationId, adapter };
    });
    const credentialPools = new Map<string, CredentialPool>();
    this.configuration.providers.forEach((provider, index) => {
      const configurationId = `${provider.kind}-${index + 1}`;
      credentialPools.set(configurationId, new CredentialPool(provider.apiKeys, { providerConfigurationId: configurationId }));
    });
    const proxyPool = new ProxyPool(this.configuration.proxies, { allowDirect: this.configuration.requestPolicy.allowDirect });
    this.advancedProxyManager = this.configuration.advancedProxy === undefined
      ? null
      : options.advancedProxyManager ?? new SingBoxProxyManager(this.configuration.advancedProxy);
    const observe = this.configuration.logger === undefined && this.configuration.telemetry === undefined
      ? undefined
      : (event: Parameters<NonNullable<NormalizedClientConfiguration["logger"]>>[0]) => {
        this.configuration.logger?.(event);
        this.configuration.telemetry?.(event);
      };
    const executor = new RequestExecutor({
      router: new ProviderRouter(registry, entries),
      requestPolicy: this.configuration.requestPolicy,
      credentialPools,
      proxyPool,
      ...(this.advancedProxyManager === null ? {} : { advancedProxyRoute: this.advancedProxyManager }),
      ...(observe === undefined ? {} : { observe }),
    });
    const priceConfiguration = this.configuration.price;
    if (priceConfiguration === undefined) {
      throw invalidConfiguration("Price configuration was not normalized.");
    }
    const priceAggregator = new TokenPriceAggregator(
        new PriceProviderRouter(priceConfiguration.providers.map((provider) => {
          try {
            return options.priceAdapters?.[provider.kind] ?? createPriceAdapter(
              provider.kind,
              provider.baseUrl,
              provider.allowInsecureHttp,
              priceConfiguration.geckoNetworks,
              options.transport,
            );
          } catch (error: unknown) {
            throw invalidConfiguration("Invalid price provider configuration.", error);
          }
        })),
        new PriceRequestExecutor({
          configuration: priceConfiguration,
          proxies: this.configuration.proxies,
          ...(this.advancedProxyManager === null ? {} : { advancedProxyRoute: this.advancedProxyManager }),
          ...(observe === undefined ? {} : { observe }),
        }),
      );
    this.chain = new ApiChainService(
      this.configuration,
      entries.map((entry) => entry.adapter),
      {
        proxyPool,
        ...(this.advancedProxyManager === null ? {} : { advancedProxyRoute: this.advancedProxyManager }),
      },
    );
    this.address = new AddressService(executor, this.chain, {
      maxRangeRecords: this.configuration.maxRangeRecords,
      maxRangeWindows: this.configuration.maxRangeWindows,
    });
    this.token = new TokenService(
      executor,
      new BlockRangeScanner({
        executor,
        maxRangeRecords: this.configuration.maxRangeRecords,
        maxRangeWindows: this.configuration.maxRangeWindows,
      }),
      this.chain,
      priceAggregator,
      priceConfiguration.tokenAliases,
    );

    const chainlinkConfiguration = this.configuration.chainlink;
    const defiConfiguration = this.configuration.defi;
    const uniswapV3Configuration = this.configuration.uniswapV3;
    const defiRpcServices = new Map<1 | 8453, RpcService>();
    const defiPools: EthereumArchiveRpcPool[] = [];
    if (chainlinkConfiguration.enabled) {
      const builtinEndpoints: readonly EthereumArchiveRpcEndpoint[] = chainlinkConfiguration.useBuiltinEthereumArchiveRpcs
        ? BUILTIN_ETHEREUM_ARCHIVE_RPCS
        : [];
      const customEndpoints: readonly EthereumArchiveRpcEndpoint[] = chainlinkConfiguration.rpcEndpoints
        .filter((endpoint) => endpoint.enabled)
        .map((endpoint) => ({ id: endpoint.id, url: endpoint.url }));
      const defiEthereumEndpoints: readonly EthereumArchiveRpcEndpoint[] = defiConfiguration.enabled && defiConfiguration.chains.includes("ethereum")
        ? defiConfiguration.rpcEndpoints.ethereum.filter((endpoint) => endpoint.enabled).map((endpoint) => ({ id: endpoint.id, url: endpoint.url }))
        : [];
      const endpoints = mergeArchiveRpcEndpoints([...builtinEndpoints, ...customEndpoints, ...defiEthereumEndpoints]);

      this.archiveRpcPool = options.archiveRpcPool ?? new EthereumArchiveRpcPool({
        endpoints,
        healthCheckTimeoutMs: chainlinkConfiguration.healthCheckTimeoutMs,
      });
      const archiveRpcExecutor = new EthereumArchiveRpcExecutor({
        pool: this.archiveRpcPool,
        randomSource: options.archiveRpcRandomSource ?? systemRandom,
        attemptTimeoutMs: chainlinkConfiguration.attemptTimeoutMs,
        totalTimeoutMs: chainlinkConfiguration.totalTimeoutMs,
        maxRpcAttempts: chainlinkConfiguration.maxRpcAttempts,
        maxConcurrentRpcAttempts: chainlinkConfiguration.maxConcurrentRpcAttempts,
      });
      this.rpc = new RpcService({
        executor: archiveRpcExecutor,
        maxCallsPerMulticall: chainlinkConfiguration.maxCallsPerMulticall,
      });
      this.chainlink = new ChainlinkService({ rpcService: this.rpc });
    } else {
      this.archiveRpcPool = null;
      this.rpc = null;
      this.chainlink = null;
    }
    for (const chain of defiConfiguration.enabled ? defiConfiguration.chains : []) {
      const chainId = chain === "ethereum" ? 1 : 8453;
      let pool: EthereumArchiveRpcPool;
      if (chainId === 1 && this.archiveRpcPool !== null) {
        pool = this.archiveRpcPool;
      } else {
        const builtins: readonly EthereumArchiveRpcEndpoint[] = defiConfiguration.useBuiltinArchiveRpcs ? (chainId === 1 ? BUILTIN_ETHEREUM_ARCHIVE_RPCS : BUILTIN_BASE_ARCHIVE_RPCS) : [];
        const custom = defiConfiguration.rpcEndpoints[chain].filter((endpoint) => endpoint.enabled).map((endpoint) => ({ id: endpoint.id, url: endpoint.url }));
        pool = options.defiArchiveRpcPools?.[chain] ?? new EthereumArchiveRpcPool({
          endpoints: [...builtins, ...custom],
          healthCheckTimeoutMs: defiConfiguration.healthCheckTimeoutMs,
          expectedChainId: chainId,
          multicall3Address: MULTICALL3_ADDRESS,
          multicall3DeploymentBlock: (chainId === 1 ? MULTICALL3_ETHEREUM_MAINNET_DEPLOYMENT_BLOCK : MULTICALL3_BASE_MAINNET_DEPLOYMENT_BLOCK).toString(),
        });
      }
      const executor = new EthereumArchiveRpcExecutor({ pool, randomSource: options.archiveRpcRandomSource ?? systemRandom, attemptTimeoutMs: defiConfiguration.attemptTimeoutMs, totalTimeoutMs: defiConfiguration.totalTimeoutMs, maxRpcAttempts: defiConfiguration.maxRpcAttempts, maxConcurrentRpcAttempts: defiConfiguration.maxConcurrentRpcAttempts });
      defiRpcServices.set(chainId, new RpcService({ executor, maxCallsPerMulticall: defiConfiguration.maxCallsPerMulticall, chainId, multicall3Address: MULTICALL3_ADDRESS, multicall3DeploymentBlock: (chainId === 1 ? MULTICALL3_ETHEREUM_MAINNET_DEPLOYMENT_BLOCK : MULTICALL3_BASE_MAINNET_DEPLOYMENT_BLOCK).toString() }));
      this.chainRpcExecutors.set(chain, executor);
      if (pool !== this.archiveRpcPool) defiPools.push(pool);
    }
    this.defiArchiveRpcPools = Object.freeze(defiPools);
    this.defi = defiConfiguration.enabled ? new DeFiExchangeRateService({ rpcServices: defiRpcServices }) : null;
    if (uniswapV3Configuration.enabled) {
      const builtin = uniswapV3Configuration.useBuiltinEthereumArchiveRpcs ? BUILTIN_ETHEREUM_ARCHIVE_RPCS : [];
      const custom = uniswapV3Configuration.rpcEndpoints.filter((endpoint) => endpoint.enabled).map((endpoint) => ({ id: endpoint.id, url: endpoint.url }));
      const pool = options.uniswapV3ArchiveRpcPool ?? this.archiveRpcPool ?? new EthereumArchiveRpcPool({
        endpoints: mergeArchiveRpcEndpoints([...builtin, ...custom]),
        healthCheckTimeoutMs: uniswapV3Configuration.healthCheckTimeoutMs,
        expectedChainId: 1,
        multicall3Address: MULTICALL3_ADDRESS,
        multicall3DeploymentBlock: MULTICALL3_ETHEREUM_MAINNET_DEPLOYMENT_BLOCK.toString(),
      });
      this.uniswapV3ArchiveRpcPool = pool;
      const executor = new EthereumArchiveRpcExecutor({ pool, randomSource: options.archiveRpcRandomSource ?? systemRandom, attemptTimeoutMs: uniswapV3Configuration.attemptTimeoutMs, totalTimeoutMs: uniswapV3Configuration.totalTimeoutMs, maxRpcAttempts: uniswapV3Configuration.maxRpcAttempts });
      this.uniswapV3 = new UniswapV3HistoricalPriceService({ rpcService: new RpcService({ executor, maxCallsPerMulticall: uniswapV3Configuration.maxCallsPerMulticall, chainId: 1, multicall3Address: MULTICALL3_ADDRESS, multicall3DeploymentBlock: MULTICALL3_ETHEREUM_MAINNET_DEPLOYMENT_BLOCK.toString() }) });
    } else {
      this.uniswapV3ArchiveRpcPool = null;
      this.uniswapV3 = null;
    }
  }

  /**
   * Finds the highest block whose timestamp is less than or equal to
   * `timestamp`, using pure public Archive RPC binary search — no indexed
   * API provider (Etherscan/Alchemy/Moralis) or API key is used. Requires
   * `defi` (or `chainlink` for `"ethereum"`) to have been enabled for
   * `chain`, since that is what provisions the Archive RPC pool this reuses.
   */
  async getBlockNumberByTimestamp(input: {
    readonly chain: "ethereum" | "base";
    readonly timestamp: string;
    readonly signal?: AbortSignal;
  }): Promise<{ readonly chainId: number; readonly blockNumber: string; readonly provider: "archive-rpc" }> {
    const rpcExecutor = this.chainRpcExecutors.get(input.chain);
    if (rpcExecutor === undefined) {
      throw invalidConfiguration(
        `Archive RPC is not enabled for chain "${input.chain}"; cannot resolve a block by timestamp via RPC.`,
      );
    }
    const chainId = input.chain === "ethereum" ? 1 : 8453;
    const deploymentBlock = BigInt(
      chainId === 1 ? MULTICALL3_ETHEREUM_MAINNET_DEPLOYMENT_BLOCK : MULTICALL3_BASE_MAINNET_DEPLOYMENT_BLOCK,
    );
    const result = await rpcExecutor.findBlockNumberByTimestamp(
      BigInt(input.timestamp),
      deploymentBlock,
      input.signal,
    );
    return { chainId, blockNumber: result.blockNumber, provider: "archive-rpc" };
  }

  /**
   * Reads the current chain head via pure public Archive RPC — no indexed
   * API provider (Etherscan/Alchemy/Moralis) or API key is used. Requires
   * `defi` (or `chainlink` for `"ethereum"`) to have been enabled for
   * `chain`, since that is what provisions the Archive RPC pool this reuses.
   */
  async getLatestBlockNumber(input: {
    readonly chain: "ethereum" | "base";
    readonly signal?: AbortSignal;
  }): Promise<{ readonly chainId: number; readonly blockNumber: string; readonly provider: "archive-rpc" }> {
    const rpcExecutor = this.chainRpcExecutors.get(input.chain);
    if (rpcExecutor === undefined) {
      throw invalidConfiguration(
        `Archive RPC is not enabled for chain "${input.chain}"; cannot resolve the latest block via RPC.`,
      );
    }
    const chainId = input.chain === "ethereum" ? 1 : 8453;
    const result = await rpcExecutor.findLatestBlockNumber(input.signal);
    return { chainId, blockNumber: result.blockNumber, provider: "archive-rpc" };
  }

  async initialize(signal?: AbortSignal): Promise<void> {
    const tasks: Promise<void>[] = [];
    if (this.advancedProxyManager !== null) {
      tasks.push(this.advancedProxyManager.initialize(signal));
    }
    if (this.archiveRpcPool !== null) {
      tasks.push(this.archiveRpcPool.initialize(signal));
    }
    for (const pool of this.defiArchiveRpcPools) tasks.push(pool.initialize(signal));
    if (this.uniswapV3ArchiveRpcPool !== null && !this.defiArchiveRpcPools.includes(this.uniswapV3ArchiveRpcPool) && this.uniswapV3ArchiveRpcPool !== this.archiveRpcPool) tasks.push(this.uniswapV3ArchiveRpcPool.initialize(signal));
    await Promise.all(tasks);
  }

  async close(): Promise<void> {
    await this.advancedProxyManager?.close();
  }
}

function mergeArchiveRpcEndpoints(endpoints: readonly EthereumArchiveRpcEndpoint[]): readonly EthereumArchiveRpcEndpoint[] {
  const ids = new Set<string>();
  const urls = new Set<string>();
  const result: EthereumArchiveRpcEndpoint[] = [];
  for (const endpoint of endpoints) {
    if (ids.has(endpoint.id) || urls.has(endpoint.url)) continue;
    ids.add(endpoint.id);
    urls.add(endpoint.url);
    result.push(endpoint);
  }
  return result;
}

function createPriceAdapter(
  kind: "binance" | "okx" | "coinbase" | "geckoterminal",
  baseUrl: string | undefined,
  allowInsecureHttp: boolean,
  geckoNetworks: readonly string[],
  transport: HttpTransport | undefined,
): TokenPriceProviderAdapter {
  const options = {
    ...(transport === undefined ? {} : { transport }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    allowInsecureHttp,
  };
  if (kind === "binance") return new BinanceAdapter(options);
  if (kind === "okx") return new OkxAdapter(options);
  if (kind === "coinbase") return new CoinbaseAdapter(options);
  return new GeckoTerminalAdapter({ ...options, networks: geckoNetworks });
}

function createAdapter(
  kind: "etherscan" | "blockscout" | "alchemy" | "moralis",
  baseUrl: string | undefined,
  allowInsecureHttp: boolean,
  transport: HttpTransport | undefined,
): DataProviderAdapter {
  const options = {
    ...(transport === undefined ? {} : { transport }),
    ...(baseUrl === undefined ? {} : { baseUrl }),
    allowInsecureHttp,
  };
  if (kind === "etherscan") return new EtherscanAdapter(options);
  if (kind === "blockscout") return new BlockscoutAdapter(options);
  if (kind === "alchemy") return new AlchemyAdapter(options);
  return new MoralisAdapter(options);
}
