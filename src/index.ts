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
  SingBoxProxyConfiguration,
  SingBoxRuntimeConfiguration,
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
} from "./domain/rpcModels";
export type {
  Erc20ReadMethod,
  Erc20MulticallCall,
  Erc20MulticallAtBlockRequest,
  Erc20MulticallAtBlockResult,
  Erc20MulticallCallResult,
} from "./domain/erc20MulticallModels";
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
export type { EvmDataClientOptions } from "./client/EvmDataClient";
export { prewarmSingBox, SUPPORTED_SING_BOX_VERSION } from "./proxy/SingBoxBinaryManager";
export type { PrewarmSingBoxOptions } from "./proxy/SingBoxBinaryManager";
export type { DataProviderAdapter, ProviderAdapterFailure } from "./providers/DataProviderAdapter";
export { BlockscoutAdapter } from "./providers/blockscout/BlockscoutAdapter";
export type {
  PriceProviderAttemptContext,
  PriceProxyLease,
  TokenPriceProviderAdapter,
} from "./price/TokenPriceProviderAdapter";
export { RpcService } from "./rpc/RpcService";
export type { ArchiveRpcMulticallExecutor, RpcServiceOptions } from "./rpc/RpcService";
export { ERC20_READ_SELECTORS, encodeErc20Read, decodeErc20Read } from "./rpc/Erc20MulticallCodec";
export { ChainlinkService } from "./chainlink/ChainlinkService";
export type { ChainlinkMulticallService, ChainlinkServiceOptions } from "./chainlink/ChainlinkService";
export type { ChainlinkFeedDefinition } from "./chainlink/ChainlinkFeedDefinition";
export { ETHEREUM_MAINNET_CHAINLINK_PRICE_FEEDS } from "./chainlink/ethereumMainnetPriceFeeds.generated";
export { BUILTIN_ETHEREUM_ARCHIVE_RPCS } from "./rpc/builtinEthereumArchiveRpcs";
export type { BuiltinEthereumArchiveRpcCandidate } from "./rpc/builtinEthereumArchiveRpcs";
export { BUILTIN_BASE_ARCHIVE_RPCS } from "./rpc/builtinBaseArchiveRpcs";
export type { BuiltinBaseArchiveRpcCandidate } from "./rpc/builtinBaseArchiveRpcs";
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
