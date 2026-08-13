import type { ChainReference } from '../domain/chains'
import type {
  BeaconWithdrawalBlockRange,
  BeaconWithdrawalPage,
  Erc20BalancesAtBlock,
  Erc20TokenHoldings,
  InternalNativeTransferBlockRange,
  InternalNativeTransferPage,
  TransactionContext,
  TransactionContextsByHashResult,
} from '../domain/models'
import { ChainRegistry } from '../chains/ChainRegistry'
import { EvmDataError, isEvmDataError } from '../domain/errors'
import type { NormalizedClientConfiguration } from '../domain/configuration'
import { EtherscanAdapter } from '../providers/etherscan/EtherscanAdapter'
import { AlchemyAdapter } from '../providers/alchemy/AlchemyAdapter'
import { MoralisAdapter } from '../providers/moralis/MoralisAdapter'
import type {
  DataProviderAdapter,
  ProviderAttemptContext,
  ProxyLease,
} from '../providers/DataProviderAdapter'
import { ProxyPool } from '../execution/ProxyPool'
import type { ManagedProxyRoute } from '../proxy/SingBoxProxyManager'

export interface ApiChainServiceOptions {
  readonly proxyPool: ProxyPool
  readonly advancedProxyRoute?: ManagedProxyRoute
}

/** API-only chain metadata operations backed by indexed explorer APIs. */
export class ApiChainService {
  private readonly registry: ChainRegistry
  private readonly providers: readonly {
    readonly adapter: DataProviderAdapter
    readonly apiKeys: readonly string[]
  }[]
  private readonly proxyPool: ProxyPool
  private readonly advancedProxyRoute: ManagedProxyRoute | undefined
  private readonly transactionContextCache = new Map<string, { readonly value: TransactionContext; readonly expiresAt: number }>()
  private readonly transactionContextInFlight = new Map<string, Promise<TransactionContext>>()
  private readonly transactionContextCacheTtlMs = 60_000

  constructor(
    configuration: NormalizedClientConfiguration,
    adapters: readonly DataProviderAdapter[],
    options: ApiChainServiceOptions,
  ) {
    this.registry = new ChainRegistry(configuration.chains)
    this.proxyPool = options.proxyPool
    this.advancedProxyRoute = options.advancedProxyRoute
    this.providers = adapters.flatMap((adapter, index) => {
      const apiKeys = configuration.providers[index]?.apiKeys ?? []
      return apiKeys.length === 0 ? [] : [{ adapter, apiKeys }]
    })
  }

  async getLatestBlockNumber(input: {
    chain: ChainReference
    signal?: AbortSignal
    now?: Date
  }): Promise<{ chainId: number; blockNumber: string; provider: 'etherscan' | 'blockscout' }> {
    const chain = this.registry.resolve(input.chain)
    const timestamp = Math.floor((input.now ?? new Date()).getTime() / 1_000).toString()
    const result = await this.withEtherscanCandidates(
      chain,
      input.signal,
      'No configured indexed API can determine the latest block.',
      async (adapter, context) => ({
        blockNumber: await adapter.getBlockNumberByTimestamp(timestamp, context),
        provider: adapter.name,
      }),
    )
    return { chainId: chain.chainId, ...result }
  }

  async getBlockNumberByTimestamp(input: {
    chain: ChainReference
    timestamp: string
    signal?: AbortSignal
  }): Promise<{ chainId: number; blockNumber: string; provider: 'etherscan' | 'blockscout' }> {
    const chain = this.registry.resolve(input.chain)
    const result = await this.withEtherscanCandidates(
      chain,
      input.signal,
      'No configured indexed API can map timestamps to blocks.',
      async (adapter, context) => ({
        blockNumber: await adapter.getBlockNumberByTimestamp(input.timestamp, context),
        provider: adapter.name,
      }),
    )
    return { chainId: chain.chainId, ...result }
  }

  /** Reads an explicit ERC-20 contract set at one historic block via indexed APIs only. */
  async getErc20BalancesAtBlock(input: {
    chain: ChainReference
    address: string
    blockNumber: string
    tokenAddresses: readonly string[]
    signal?: AbortSignal
  }): Promise<Erc20BalancesAtBlock> {
    const chain = this.registry.resolve(input.chain)
    return this.withTokenBalanceCandidates(
      chain,
      input.signal,
      'No configured indexed API can read historical ERC-20 balances.',
      async (adapter, context) => {
        if (adapter instanceof MoralisAdapter) {
          return adapter.getErc20BalancesAtBlock({
            address: input.address,
            blockNumber: input.blockNumber,
            tokenAddresses: input.tokenAddresses,
          }, context)
        }
        if (adapter instanceof AlchemyAdapter) {
          return adapter.getErc20BalancesAtBlock({
            address: input.address,
            blockNumber: input.blockNumber,
            tokenAddresses: input.tokenAddresses,
          }, context)
        }
        const items = []
        for (const tokenAddress of input.tokenAddresses) {
          items.push(await adapter.getErc20BalanceAtBlock({
            address: input.address,
            tokenAddress,
            blockNumber: input.blockNumber,
          }, context))
        }
        return {
          chainId: chain.chainId,
          address: input.address,
          blockNumber: input.blockNumber,
          items,
          provider: adapter.name,
        }
      },
      { includeAlchemy: true },
    )
  }

  /** Full current holdings list for historic-token discovery, never a snapshot. */
  async getErc20TokenHoldings(input: {
    chain: ChainReference
    address: string
    signal?: AbortSignal
  }): Promise<Erc20TokenHoldings> {
    const chain = this.registry.resolve(input.chain)
    let moralisBlockNumber: string | undefined
    return this.withTokenBalanceCandidates(
      chain,
      input.signal,
      'No configured indexed API can list ERC-20 holdings.',
      async (adapter, context) => {
        if (adapter instanceof MoralisAdapter) {
          moralisBlockNumber ??= await this.latestBlockNumberForMoralis(chain, input.signal)
          return adapter.getErc20TokenHoldings({
            address: input.address,
            blockNumber: moralisBlockNumber,
          }, context)
        }
        if (adapter instanceof AlchemyAdapter) {
          return adapter.getErc20TokenHoldings({ address: input.address }, context)
        }
        return adapter.getErc20TokenHoldings({ address: input.address }, context)
      },
      { includeAlchemy: true },
    )
  }

  /** One complete indexed transaction/receipt/log context for every requested hash. */
  async getTransactionContextsByHash(input: {
    chain: ChainReference
    transactionHashes: readonly string[]
    signal?: AbortSignal
  }): Promise<TransactionContextsByHashResult> {
    const chain = this.registry.resolve(input.chain)
    return this.withTransactionContextCandidates(
      chain,
      input.signal,
      'No configured API-only provider can read transaction receipt logs.',
      async (adapter, context) => {
        const items = []
        for (const transactionHash of input.transactionHashes) {
          items.push(await this.getCachedTransactionContext(adapter, chain.chainId, transactionHash, context))
        }
        return {
          chainId: chain.chainId,
          items,
          provider: 'moralis' as const,
          upstreamRequests: items.length,
        }
      },
    )
  }

  /**
   * Explicit transaction-context reads are intentionally small and cache only
   * normalized mined data. No timer refreshes this cache; it is populated only
   * by a caller request and in-flight calls for the same hash are coalesced.
   */
  private async getCachedTransactionContext(
    adapter: MoralisAdapter,
    chainId: number,
    transactionHash: string,
    context: ProviderAttemptContext,
  ): Promise<TransactionContext> {
    const key = `${adapter.name}:${chainId}:${transactionHash}`
    const now = Date.now()
    const cached = this.transactionContextCache.get(key)
    if (cached !== undefined && cached.expiresAt > now) return cached.value
    const pending = this.transactionContextInFlight.get(key)
    if (pending !== undefined) return pending
    const request = adapter.getTransactionContextByHash!({ transactionHash }, context)
      .then((value) => {
        this.transactionContextCache.set(key, {
          value,
          expiresAt: Date.now() + this.transactionContextCacheTtlMs,
        })
        return value
      })
      .finally(() => {
        this.transactionContextInFlight.delete(key)
      })
    this.transactionContextInFlight.set(key, request)
    return request
  }

  async getInternalNativeTransfersByBlockRange(input: {
    chain: ChainReference
    address: string
    startBlock: string
    endBlock: string
    signal?: AbortSignal
  }): Promise<InternalNativeTransferBlockRange> {
    const chain = this.registry.resolve(input.chain)
    return this.withInternalNativeCandidates(
      chain,
      input.signal,
      'No configured indexed API can list internal native transfers.',
      (adapter, context) => adapter.getInternalNativeTransfersByBlockRange(input, context),
    )
  }

  async getInternalNativeTransfersPage(input: {
    chain: ChainReference
    address: string
    startBlock: string
    endBlock: string
    page: number
    signal?: AbortSignal
  }): Promise<InternalNativeTransferPage> {
    const chain = this.registry.resolve(input.chain)
    return this.withInternalNativeCandidates(chain, input.signal, 'No configured indexed API can list internal native transfers.', async (adapter, context) => {
      const pageMethod = (adapter as DataProviderAdapter).getInternalNativeTransfersPage
      if (typeof pageMethod !== 'function') throw new EvmDataError({ code: 'UNSUPPORTED_OPERATION', message: 'Provider page method is unavailable.', retryable: false, provider: adapter.name, chainId: chain.chainId })
      return pageMethod.call(adapter, input, context)
    })
  }

  async getBeaconWithdrawalsByBlockRange(input: {
    chain: ChainReference
    address: string
    startBlock: string
    endBlock: string
    signal?: AbortSignal
  }): Promise<BeaconWithdrawalBlockRange> {
    const chain = this.registry.resolve(input.chain)
    return this.withEtherscanCandidates(
      chain,
      input.signal,
      'No configured indexed API can list Beacon withdrawals.',
      (adapter, context) => adapter.getBeaconWithdrawalsByBlockRange(input, context),
    )
  }

  async getBeaconWithdrawalsPage(input: {
    chain: ChainReference
    address: string
    startBlock: string
    endBlock: string
    page: number
    signal?: AbortSignal
  }): Promise<BeaconWithdrawalPage> {
    const chain = this.registry.resolve(input.chain)
    return this.withEtherscanCandidates(chain, input.signal, 'No configured indexed API can list Beacon withdrawals.', async (adapter, context) => {
      const pageMethod = (adapter as DataProviderAdapter).getBeaconWithdrawalsPage
      if (typeof pageMethod !== 'function') throw new EvmDataError({ code: 'UNSUPPORTED_OPERATION', message: 'Provider page method is unavailable.', retryable: false, provider: adapter.name, chainId: chain.chainId })
      return pageMethod.call(adapter, input, context)
    })
  }

  private async withEtherscanCandidates<T>(
    chain: ReturnType<ChainRegistry['resolve']>,
    signal: AbortSignal | undefined,
    unavailableMessage: string,
    work: (adapter: EtherscanAdapter, context: ProviderAttemptContext) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown
    for (const configuredProvider of this.providers) {
      if (!(configuredProvider.adapter instanceof EtherscanAdapter)) continue
      for (const apiKey of configuredProvider.apiKeys) {
        const candidate = { adapter: configuredProvider.adapter, apiKey }
        try {
          return await this.withCandidateContext(chain, candidate, signal, (context) =>
            work(configuredProvider.adapter as EtherscanAdapter, context),
          )
        } catch (error) {
          lastError = error
          if (!canTryAnotherEtherscanCredential(error)) throw error
        }
      }
    }
    throw unavailable(lastError, chain.chainId, unavailableMessage)
  }

  private async withInternalNativeCandidates<T>(
    chain: ReturnType<ChainRegistry['resolve']>,
    signal: AbortSignal | undefined,
    unavailableMessage: string,
    work: (adapter: EtherscanAdapter | AlchemyAdapter, context: ProviderAttemptContext) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown
    for (const configuredProvider of this.providers) {
      const adapter = configuredProvider.adapter
      if (!(adapter instanceof EtherscanAdapter) && !(adapter instanceof AlchemyAdapter)) continue
      for (const apiKey of configuredProvider.apiKeys) {
        try {
          return await this.withCandidateContext(chain, { adapter, apiKey }, signal, (context) => work(adapter, context))
        } catch (error) {
          lastError = error
          if (!canTryAnotherApiCredential(error)) throw error
        }
      }
    }
    throw unavailable(lastError, chain.chainId, unavailableMessage)
  }

  /** Moralis requires `to_block` even when the caller requests current holdings. */
  private async latestBlockNumberForMoralis(
    chain: ReturnType<ChainRegistry['resolve']>,
    signal: AbortSignal | undefined,
  ): Promise<string> {
    const timestamp = Math.floor(Date.now() / 1_000).toString()
    return this.withEtherscanCandidates(
      chain,
      signal,
      'No configured indexed API can determine the block for Moralis holdings.',
      (adapter, context) => adapter.getBlockNumberByTimestamp(timestamp, context),
    )
  }

  /**
   * These providers expose an exact-balance operation. Alchemy is restricted
   * to caller-supplied contracts and uses one Multicall3 `eth_call` per batch.
   */
  private async withTokenBalanceCandidates<T>(
    chain: ReturnType<ChainRegistry['resolve']>,
    signal: AbortSignal | undefined,
    unavailableMessage: string,
    work: (adapter: EtherscanAdapter | AlchemyAdapter | MoralisAdapter, context: ProviderAttemptContext) => Promise<T>,
    options: { includeAlchemy?: boolean } = {},
  ): Promise<T> {
    let lastError: unknown
    for (const configuredProvider of this.providers) {
      const adapter = configuredProvider.adapter
      if (!(adapter instanceof EtherscanAdapter) &&
          !(adapter instanceof MoralisAdapter) &&
          !(options.includeAlchemy === true && adapter instanceof AlchemyAdapter)) continue
      for (const apiKey of configuredProvider.apiKeys) {
        try {
          return await this.withCandidateContext(chain, { adapter, apiKey }, signal, (context) =>
            work(adapter, context),
          )
        } catch (error) {
          lastError = error
          if (!canTryAnotherApiCredential(error)) throw error
        }
      }
    }
    throw unavailable(lastError, chain.chainId, unavailableMessage)
  }

  private async withTransactionContextCandidates<T>(
    chain: ReturnType<ChainRegistry['resolve']>,
    signal: AbortSignal | undefined,
    unavailableMessage: string,
    work: (adapter: MoralisAdapter, context: ProviderAttemptContext) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown
    for (const configuredProvider of this.providers) {
      const adapter = configuredProvider.adapter
      if (!(adapter instanceof MoralisAdapter)) continue
      for (const apiKey of configuredProvider.apiKeys) {
        try {
          return await this.withCandidateContext(chain, { adapter, apiKey }, signal, (context) =>
            work(adapter, context),
          )
        } catch (error) {
          lastError = error
          if (!canTryAnotherApiCredential(error)) throw error
        }
      }
    }
    throw unavailable(lastError, chain.chainId, unavailableMessage)
  }

  private async withCandidateContext<T>(
    chain: ReturnType<ChainRegistry['resolve']>,
    candidate: { readonly adapter: DataProviderAdapter; readonly apiKey: string },
    signal: AbortSignal | undefined,
    work: (context: ProviderAttemptContext) => Promise<T>,
  ): Promise<T> {
    const proxy = await this.acquireProxy(signal)
    try {
      const result = await work(providerContext(chain, candidate.apiKey, signal, proxy))
      this.reportProxy(proxy, 'success')
      return result
    } catch (error) {
      this.reportProxy(proxy, proxyOutcome(error))
      throw error
    }
  }

  private async acquireProxy(signal: AbortSignal | undefined): Promise<ProxyLease | null> {
    if (this.advancedProxyRoute !== undefined) {
      this.advancedProxyRoute.assertReady()
      return this.advancedProxyRoute.acquire(signal)
    }
    const lease = this.proxyPool.acquire()
    if (lease !== undefined) return lease
    throw new EvmDataError({
      code: 'PROXY_ERROR',
      message: 'No permitted API proxy route is available.',
      retryable: true,
    })
  }

  private reportProxy(lease: ProxyLease | null, outcome: 'success' | 'proxy_failure' | 'neutral') {
    if (lease === null) return
    this.proxyPool.report(lease, outcome)
    this.advancedProxyRoute?.report(lease, outcome)
  }
}

function providerContext(
  chain: ReturnType<ChainRegistry['resolve']>,
  apiKey: string,
  signal: AbortSignal | undefined,
  proxy: ProxyLease | null,
): ProviderAttemptContext {
  return {
    chain,
    credential: { id: 'api-chain', value: apiKey },
    proxy,
    timeoutMs: 15_000,
    ...(signal === undefined ? {} : { signal }),
    correlationId: 'api-chain-' + chain.chainId.toString(),
  }
}

function unavailable(lastError: unknown, chainId: number, message: string): EvmDataError {
  return lastError instanceof EvmDataError
    ? lastError
    : new EvmDataError({ code: 'UNSUPPORTED_OPERATION', message, retryable: false, chainId })
}

function proxyOutcome(error: unknown): 'proxy_failure' | 'neutral' {
  if (!isEvmDataError(error)) return 'proxy_failure'
  return error.code === 'NETWORK_ERROR' || error.code === 'REQUEST_TIMEOUT' || error.code === 'PROXY_ERROR'
    ? 'proxy_failure'
    : 'neutral'
}

function canTryAnotherEtherscanCredential(error: unknown) {
  return canTryAnotherApiCredential(error)
}

function canTryAnotherApiCredential(error: unknown) {
  return error instanceof EvmDataError && (
    error.retryable ||
    error.code === 'AUTHENTICATION_FAILED' ||
    error.code === 'PLAN_RESTRICTED'
  )
}
