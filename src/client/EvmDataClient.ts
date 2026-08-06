import type { ClientConfiguration, NormalizedClientConfiguration } from "../domain/configuration";
import { parseClientConfiguration } from "../domain/configuration";
import { invalidConfiguration } from "../domain/errors";
import { ChainRegistry } from "../chains/ChainRegistry";
import { CredentialPool } from "../execution/CredentialPool";
import { ProviderRouter } from "../execution/ProviderRouter";
import { ProxyPool } from "../execution/ProxyPool";
import { RequestExecutor } from "../execution/RequestExecutor";
import { BlockRangeScanner } from "../execution/BlockRangeScanner";
import { AddressService } from "../services/AddressService";
import { TokenService } from "../services/TokenService";
import { EtherscanAdapter } from "../providers/etherscan/EtherscanAdapter";
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

export interface EvmDataClientOptions {
  readonly transport?: HttpTransport;
  readonly adapters?: Partial<Record<"etherscan" | "alchemy" | "moralis", DataProviderAdapter>>;
  readonly priceAdapters?: Partial<Record<"binance" | "okx" | "coinbase" | "geckoterminal", TokenPriceProviderAdapter>>;
  /** Test seam for the optional managed proxy; it never changes public configuration. */
  readonly advancedProxyManager?: SingBoxProxyManager;
}

export class EvmDataClient {
  readonly address: AddressService;
  readonly token: TokenService;

  private readonly configuration: NormalizedClientConfiguration;
  private readonly advancedProxyManager: SingBoxProxyManager | null;

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
    this.address = new AddressService(executor);
    this.token = new TokenService(
      executor,
      new BlockRangeScanner({
        executor,
        maxRangeRecords: this.configuration.maxRangeRecords,
        maxRangeWindows: this.configuration.maxRangeWindows,
      }),
      priceAggregator,
      priceConfiguration.tokenAliases,
    );
  }

  async initialize(signal?: AbortSignal): Promise<void> {
    if (this.advancedProxyManager === null) return;
    await this.advancedProxyManager.initialize(signal);
  }

  async close(): Promise<void> {
    await this.advancedProxyManager?.close();
  }
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
  kind: "etherscan" | "alchemy" | "moralis",
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
  if (kind === "alchemy") return new AlchemyAdapter(options);
  return new MoralisAdapter(options);
}
