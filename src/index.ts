export {
  EvmDataError,
  isEvmDataError,
} from "./domain/errors";

export type {
  AlchemyConfiguration,
  BlockscoutConfiguration,
  ChainlinkConfiguration,
  DeFiConfiguration,
  UniswapV3Configuration,
  UniswapV4Configuration,
  ClientConfiguration,
  StorageConfiguration,
  NormalizedStorageConfiguration,
  SyncConfiguration,
  ReplayConfiguration,
  EtherscanConfiguration,
  EthereumArchiveRpcEndpointConfiguration,
  MoralisConfiguration,
  ObservationCallback,
  PriceConfiguration,
  PriceProviderConfiguration,
  ProviderConfiguration,
  ProviderConfigurationBase,
  ProxyConfiguration,
  RequestPolicy,
  TelemetryEvent,
} from "./domain/configuration";
export type {
  UniswapV3HistoricalPriceRequest,
  UniswapV3HistoricalPriceResult,
  UniswapV3HistoricalPrice,
  UniswapV3TokenPriceAtBlockRequest,
  UniswapV3TokenPriceAtBlockResult,
  UniswapV3TokenPricesAtBlockRequest,
  UniswapV3TokenPricesAtBlockResult,
  UniswapV3PriceAsset,
  UniswapV3PriceFailure,
  UniswapV3PriceFailureCode,
} from "./domain/uniswapV3HistoricalPriceModels";
export type { UniswapV4HistoricalPriceRequest, UniswapV4HistoricalPriceResult, UniswapV4HistoricalPrice, UniswapV4TokenPriceAtBlockRequest, UniswapV4TokenPriceAtBlockResult, UniswapV4TokenPricesAtBlockRequest, UniswapV4TokenPricesAtBlockResult, UniswapV4Currency, UniswapV4PriceFailure, UniswapV4PriceFailureCode } from "./domain/uniswapV4HistoricalPriceModels";
export type {
  DeFiExchangeRate,
  DeFiExchangeRateFailure,
  DeFiExchangeRateFailureCode,
  DeFiExchangeRateSnapshot,
  DeFiExchangeRateSnapshotRequest,
  DeFiTokenKind,
  DeFiUnderlyingRate,
} from "./domain/defiExchangeRateModels";
export type {
  ChainlinkFeedFailure,
  ChainlinkFeedFailureCode,
  ChainlinkPriceAtBlock,
  ChainlinkTokenPricesAtBlockRequest,
  ChainlinkTokenPricesAtBlockResult,
} from "./domain/chainlinkModels";
export type {
  MulticallAtBlockCall,
  MulticallAtBlockCallResult,
  MulticallAtBlockRequest,
  MulticallAtBlockResult,
  NativeBalanceAtBlockRequest,
  NativeBalanceAtBlockResult,
  JsonRpcRequest,
  JsonRpcError,
  JsonRpcBatchItemResult,
  JsonRpcBatchExecutionOptions,
  NormalizedJsonRpcRequest,
  NormalizedJsonRpcBatchRequest,
  Erc20ReadMethod,
  Erc20MulticallCall,
  Erc20MulticallAtBlockRequest,
  Erc20MulticallAtBlockResult,
  Erc20MulticallCallResult,
} from "evm-call";
export {
  parseJsonRpcRequests,
  parseMulticallAtBlockRequest,
  parseNativeBalanceAtBlockRequest,
  parseErc20MulticallAtBlockRequest,
} from "evm-call";
export type {
  AlchemyRoute,
  BlockscoutRoute,
  BuiltinProviderName,
  ChainDefinition,
  ChainReference,
  ChainRoutes,
  EtherscanRoute,
  MoralisRoute,
  NativeCurrency,
  ProviderName,
} from "./domain/chains";
export type { ErrorCode, EvmDataErrorOptions } from "./domain/errors";
export type {
  Erc20TransfersRequest,
  Erc20BlockRangeRequest,
  Erc20BalancesAtBlockRequest,
  Erc20HoldingsAtBlockRequest,
  Erc20TokenHoldingsRequest,
  BeaconWithdrawalsBlockRangeRequest,
  InternalNativeTransfersBlockRangeRequest,
  NativeBalanceRequest,
  TransactionContextsByHashRequest,
  OperationName,
  SortOrder,
  TransactionsBlockRangeRequest,
  TransactionsRequest,
  TransferDirection,
} from "./domain/operations";
export type { DatasetUpdateRequest, DatasetUpdateResult, RecollectRequest, RecollectResult, SyncAuditRequest, SyncAuditResult, SyncDataset, SyncStatus } from "./domain/syncModels";
export type { HistoryAddressRequest, HistoryInitialState, ReplayStatus, UserStateAtBlockRequest, UserStateAtBlockResult, TokenFlowHistoryRequest, HistoryReplayRequest, HistoryRebuildRequest, HistoryReplayResult, HistoryRebuildResult } from "./domain/historyModels";
export type { PriceUpdateRequest, PriceUpdateResult, PriceRecollectRequest, PricePointQuery, PriceAtResult, PriceSyncScopeRequest } from "./domain/priceSyncModels";
export type {
  NormalizedTokenPriceRequest,
  TokenPriceHistoryRequest,
  TokenPriceRange,
} from "./domain/priceOperations";
export type {
  TokenPriceAggregationResult,
  TokenPricePoint,
  TokenPriceProviderFailure,
  TokenPriceProviderName,
  TokenPriceProviderResult,
} from "./domain/priceModels";
export type { BinanceFiveMinuteKlineRequest, BinanceFiveMinuteKlinePoint, BinanceFiveMinuteKlineResult } from "./domain/binanceKlineModels";
export type { GateKlineRequest, GateKlinePoint } from "./domain/gateKlineModels";
export type { PageInfo } from "./domain/pagination";
export type {
  BlockRange,
  Erc20BlockRangeResult,
  Erc20BlockRangeStats,
  Erc20BlockRangeWindow,
  Erc20Transfer,
  Erc20TransferPage,
  Erc20BalanceAtBlock,
  Erc20BalancesAtBlock,
  Erc20HoldingsAtBlock,
  Erc20TokenHolding,
  Erc20TokenHoldings,
  InternalNativeTransfer,
  InternalNativeTransferBlockRange,
  InternalNativeTransferPage,
  InternalNativeTransferBlockRangeWindow,
  BeaconWithdrawal,
  BeaconWithdrawalBlockRange,
  BeaconWithdrawalPage,
  BeaconWithdrawalBlockRangeWindow,
  NativeBalance,
  Page,
  Transaction,
  TransactionContext,
  TransactionContextsByHashResult,
  TransactionReceipt,
  TransactionReceiptLog,
  TransactionBlockRange,
  TransactionBlockPage,
  TransactionBlockRangeWindow,
} from "./domain/models";
export { ApiChainService } from './services/ApiChainService';
export { EvmDataClient } from "./client/EvmDataClient";
export { SqliteStorageAdapter, PostgresStorageAdapter } from "./storage/StorageAdapter";
export type { EvmDataClientOptions } from "./client/EvmDataClient";
export type { DataProviderAdapter, ProviderAdapterFailure } from "./providers/DataProviderAdapter";
export { BlockscoutAdapter } from "./providers/blockscout/BlockscoutAdapter";
export { GateAdapter } from "./providers/price/gate/GateAdapter";
export type {
  PriceProviderAttemptContext,
  PriceProxyLease,
  TokenPriceProviderAdapter,
} from "./price/TokenPriceProviderAdapter";
export {
  ArchiveRpcTransport,
  JsonRpcCallError,
  isJsonRpcCallError,
  JsonRpcBatchExecutor,
  EthereumArchiveRpcExecutor,
  RpcPool,
  ERC20_READ_SELECTORS,
  encodeErc20Read,
  decodeErc20Read,
  encodeAggregate3,
  decodeAggregate3Result,
  MULTICALL3_ADDRESS,
  MULTICALL3_BASE_MAINNET_DEPLOYMENT_BLOCK,
  MULTICALL3_ETHEREUM_MAINNET_DEPLOYMENT_BLOCK,
  BUILTIN_ETHEREUM_RPCS as BUILTIN_ETHEREUM_ARCHIVE_RPCS,
  BUILTIN_BASE_RPCS as BUILTIN_BASE_ARCHIVE_RPCS,
} from "evm-call";
export type {
  ArchiveRpcCallOptions,
  ArchiveRpcBatchCallOptions,
  ArchiveRpcTransportOptions,
  JsonRpcBatchResponseItem,
  JsonRpcBatchExecutorOptions,
  RpcPoolLike,
  RpcEndpoint,
  RpcPoolOptions,
  BuiltinRpcEndpoint as BuiltinEthereumArchiveRpcCandidate,
  BuiltinRpcEndpoint as BuiltinBaseArchiveRpcCandidate,
} from "evm-call";
export { RpcService } from "./rpc/RpcService";
export type { ArchiveRpcMulticallExecutor, RpcServiceOptions } from "./rpc/RpcService";
export { ChainlinkService } from "./chainlink/ChainlinkService";
export type { ChainlinkMulticallService, ChainlinkServiceOptions } from "./chainlink/ChainlinkService";
export type { ChainlinkFeedDefinition } from "./chainlink/ChainlinkFeedDefinition";
export { ETHEREUM_MAINNET_CHAINLINK_PRICE_FEEDS } from "./chainlink/ethereumMainnetPriceFeeds.generated";
export { DeFiExchangeRateService } from "./defi/DeFiExchangeRateService";
export type { DeFiMulticallService, DeFiExchangeRateServiceOptions } from "./defi/DeFiExchangeRateService";
export { DEFI_TOKEN_REGISTRY } from "./defi/defiTokenRegistry";
export { DEFI_PROTOCOL_SCOPE } from "./defi/defiProtocolScope";
export type { DeFiProtocolScopeChain } from "./defi/defiProtocolScope";
export type { DeFiTokenDefinition, DeFiUnderlyingDefinition, DeFiAdapterKind } from "./defi/DeFiTokenDefinition";
export { UniswapV3HistoricalPriceService } from "./defi/UniswapV3HistoricalPriceService";
export type { UniswapV3MulticallService, UniswapV3HistoricalPriceServiceOptions } from "./defi/UniswapV3HistoricalPriceService";
export type { UniswapV3TokenDefinition } from "./defi/UniswapV3TokenDefinition";
export { UNISWAP_V3_TOKEN_REGISTRY, UNISWAP_V3_TOKEN_REGISTRY_VERSION, uniswapV3RegistryVersion } from "./defi/uniswapV3TokenRegistry";
export { decodeUniswapV3Slot0, UNISWAP_V3_SLOT0_SELECTOR } from "./defi/UniswapV3Slot0Codec";
export { getSqrtRatioAtTick, ratioForSqrtPrice } from "./defi/UniswapV3PriceMath";
export { UniswapV4HistoricalPriceService } from "./defi/uniswap/v4/UniswapV4HistoricalPriceService";
export type { UniswapV4PoolDefinition } from "./defi/uniswap/v4/UniswapV4PoolDefinition";
export { UNISWAP_V4_TOKEN_REGISTRY, UNISWAP_V4_TOKEN_REGISTRY_VERSION, uniswapV4RegistryVersion } from "./defi/uniswap/v4/uniswapV4PoolRegistry";
export { encodeStateViewSlot0, decodeUniswapV4StateViewSlot0, UNISWAP_V4_STATE_VIEW_SLOT0_SELECTOR } from "./defi/uniswap/v4/UniswapV4StateViewCodec";
export { EnvLoader, parseEnvContent, loadClientConfigurationFromEnv } from "./env/EnvLoader";
export type { EnvLoaderOptions, SupportedRpcChain } from "./env/EnvLoader";

export {
  CooldownTracker,
  COOLDOWN_TIERS_MS,
  MAX_COOLDOWN_MS,
} from "./execution/CooldownTracker";
export type {
  CooldownTrackerOptions,
  CooldownState,
} from "./execution/CooldownTracker";

export { EthereumArchiveRpcPool } from "./rpc/EthereumArchiveRpcPool";
export type {
  EthereumArchiveRpcPoolOptions,
  EthereumArchiveRpcEndpoint,
  EndpointCooldownState,
  ArchiveRpcOutcome,
} from "./rpc/EthereumArchiveRpcPool";

export { CredentialPool } from "./execution/CredentialPool";
export type {
  CredentialPoolOptions,
  CredentialState,
  CredentialCooldownState,
  CredentialPoolOutcome,
} from "./execution/CredentialPool";

export {
  SlackWebhookReporter,
  buildSlackAlertPayload,
  formatDuration,
} from "./alert/SlackWebhookReporter";
export type {
  AlertFaultItem,
  KeyFamilySummary,
  SlackWebhookPayload,
  SlackWebhookReporterOptions,
  SlackWebhookReportResult,
} from "./alert/SlackWebhookReporter";
export type {
  AlertReporter,
  AlertReportResult,
} from "./alert/AlertReporter";

export { AlertService } from "./alert/AlertService";
export type {
  AlertServiceOptions,
  AlertSources,
} from "./alert/AlertService";

export type {
  AlertConfiguration,
  NormalizedAlertConfiguration,
} from "./domain/configuration";

export { CooldownStore } from "./storage/CooldownStore";
export type {
  PersistedCooldownRecord,
  SaveCooldownParams,
} from "./storage/CooldownStore";

export type {
  KlineInterval,
  KlinePoint,
  KlineRequest,
  KlineResult,
  NormalizedKlineRequest,
} from "./domain/klineModels";
export { normalizeKlineRequest } from "./domain/klineModels";

export type {
  TokenSupportProvider,
  TokenSupportRecord,
  TokenSupportStatusMap,
} from "./domain/tokenSupportModels";

export { TokenSupportStore } from "./storage/TokenSupportStore";
export { TokenSupportService } from "./price/TokenSupportService";
export type { TokenSupportServiceOptions } from "./price/TokenSupportService";

export { KlineBinaryCodec, KLINE_RECORD_SIZE } from "./price/archive/KlineBinaryCodec";
export { KlineArchiveManager } from "./price/archive/KlineArchiveManager";
export type { KlineArchiveManagerOptions } from "./price/archive/KlineArchiveManager";
export type { ArchiveProviderAdapter } from "./price/archive/ArchiveProviderAdapter";
export { BinanceArchiveAdapter } from "./price/archive/BinanceArchiveAdapter";
export { GateArchiveAdapter } from "./price/archive/GateArchiveAdapter";
export { UnifiedKlineService, getOverlappingCalendarMonths } from "./price/UnifiedKlineService";
export type { UnifiedKlineServiceOptions } from "./price/UnifiedKlineService";
