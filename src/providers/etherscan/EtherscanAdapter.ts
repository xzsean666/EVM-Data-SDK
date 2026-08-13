import { AxiosHttpTransport, parseHttpProxyUrl } from "../../transport/AxiosHttpTransport";
import type { HttpTransport } from "../../transport/HttpTransport";
import type {
  CapabilityRequest,
  DataProviderAdapter,
  ProviderBlockRangeItem,
  ProviderBlockRangeWindowResult,
  ProviderAttemptContext,
} from "../DataProviderAdapter";
import type { ProviderName } from "../../domain/chains";
import type {
  NormalizedErc20BlockRangeRequest,
  NormalizedErc20TransfersRequest,
  NormalizedNativeBalanceRequest,
  NormalizedTransactionsRequest,
} from "../../domain/operations";
import { MAX_PAGE_SIZE } from "../../domain/operations";
import type { ProviderPageResult } from "../../domain/pagination";
import type { BeaconWithdrawal, BeaconWithdrawalBlockRange, Erc20BalanceAtBlock, Erc20TokenHolding, Erc20TokenHoldings, Erc20Transfer, InternalNativeTransfer, InternalNativeTransferBlockRange, NativeBalance, Transaction } from "../../domain/models";
import { EvmDataError } from "../../domain/errors";
import {
  classifyEtherscanEnvelopeError,
  classifyEtherscanStandardEndpointError,
  classifyEtherscanHttpResponse,
  normalizeEtherscanTransportError,
} from "./etherscanErrors";
import {
  etherscanBalanceEnvelopeSchema,
  etherscanBeaconWithdrawalEnvelopeSchema,
  etherscanInternalTransactionEnvelopeSchema,
  etherscanTokenHoldingEnvelopeSchema,
  etherscanTokenTransferEnvelopeSchema,
  etherscanTransactionListEnvelopeSchema,
} from "./etherscanSchemas";
import {
  mapEtherscanBalance,
  mapEtherscanBeaconWithdrawal,
  mapEtherscanInternalTransaction,
  mapEtherscanTokenHolding,
  mapEtherscanTokenTransfer,
  mapEtherscanTransaction,
} from "./etherscanMapper";

export const ETHERSCAN_V2_BASE_URL = "https://api.etherscan.io/v2/api";
/**
 * Etherscan's account-list endpoints truncate each physical response at
 * 1,000 records, including when a larger `offset` is requested. Keep this
 * separate from the SDK's public logical page size (10,000) so callers can
 * continue through provider cursors while every upstream page is complete.
 */
export const ETHERSCAN_MAX_PAGE_SIZE = 1_000;

export interface EtherscanAdapterOptions {
  readonly transport?: HttpTransport;
  readonly baseUrl?: string;
  readonly allowInsecureHttp?: boolean;
  /** Internal compatibility seam used by BlockscoutAdapter. */
  readonly providerName?: "etherscan" | "blockscout";
  readonly routeName?: "etherscan" | "blockscout";
  readonly defaultBaseUrl?: string;
}

interface EtherscanPageState {
  readonly page: number;
}

export class EtherscanAdapter implements DataProviderAdapter {
  readonly name: "etherscan" | "blockscout";

  protected readonly transport: HttpTransport;
  protected readonly baseUrl: string;
  private readonly routeName: "etherscan" | "blockscout";
  /** Etherscan caps historical/holding PRO endpoints at two requests/second. */
  private historicalBalanceNextAt = 0;

  constructor(options: EtherscanAdapterOptions = {}) {
    this.name = options.providerName ?? "etherscan";
    this.routeName = options.routeName ?? "etherscan";
    this.transport = options.transport ?? new AxiosHttpTransport();
    this.baseUrl = normalizeBaseUrl(
      options.baseUrl ?? options.defaultBaseUrl ?? ETHERSCAN_V2_BASE_URL,
      options.allowInsecureHttp ?? false,
      this.name,
    );
  }

  supports(request: CapabilityRequest): boolean {
    if (this.routeFor(request.chain) === undefined) return false;
    if (request.operation === "getNativeBalance") return true;
    if (request.operation === "getErc20TransfersByBlockRange") return true;
    // The adapter can satisfy the SDK's public 10,000-record logical page
    // through Etherscan's 1,000-record physical pages and provider cursors.
    return "pageSize" in request.request && request.request.pageSize <= MAX_PAGE_SIZE;
  }

  private routeFor(chain: ProviderAttemptContext["chain"]): { readonly chainId?: string; readonly apiUrl: string } | undefined {
    if (this.routeName === "blockscout") {
      const route = chain.routes.blockscout;
      return route;
    }
    const route = chain.routes.etherscan;
    return route === undefined ? undefined : { ...route, apiUrl: this.baseUrl };
  }

  protected endpointFor(chain: ProviderAttemptContext["chain"]): string {
    if (this.routeName === "blockscout") {
      return this.baseUrl === ETHERSCAN_V2_BASE_URL
        ? chain.routes.blockscout?.apiUrl ?? this.baseUrl
        : this.baseUrl;
    }
    return this.baseUrl;
  }

  async getTransactions(
    request: NormalizedTransactionsRequest,
    context: ProviderAttemptContext,
  ): Promise<ProviderPageResult<Transaction, EtherscanPageState>> {
    const page = readPageState(context.providerPageState, this.name);
    const body = await this.call("txlist", {
      address: request.address,
      page,
      offset: etherscanPageSize(request.pageSize),
      sort: request.order,
      ...(request.startBlock === null ? {} : { startblock: request.startBlock }),
      ...(request.endBlock === null ? {} : { endblock: request.endBlock }),
    }, context);
    const envelope = etherscanTransactionListEnvelopeSchema.safeParse(body);
    if (!envelope.success) {
      throw invalidResponse(context, undefined, this.name);
    }
    if (envelope.data.status === "0") {
      if (isEmptyMessage(envelope.data.message, envelope.data.result, "transactions")) {
        return pageResult([], null, context, this.name);
      }
      throw classifyEtherscanEnvelopeError(envelope.data.message, envelope.data.result, context.chain.chainId, this.name);
    }
    if (!Array.isArray(envelope.data.result)) {
      throw invalidResponse(context, undefined, this.name);
    }
    try {
      const items = envelope.data.result.map((item) => mapEtherscanTransaction(item, context.chain, this.name));
      return pageResult(items, nextPage(items.length, etherscanPageSize(request.pageSize), page), context, this.name);
    } catch (error: unknown) {
      throw invalidResponse(context, error, this.name);
    }
  }

  async getNativeBalance(
    request: NormalizedNativeBalanceRequest,
    context: ProviderAttemptContext,
  ): Promise<NativeBalance> {
    const body = await this.call("balance", { address: request.address, tag: "latest" }, context);
    const envelope = etherscanBalanceEnvelopeSchema.safeParse(body);
    if (!envelope.success) {
      throw invalidResponse(context, undefined, this.name);
    }
    if (envelope.data.status === "0") {
      throw classifyEtherscanEnvelopeError(envelope.data.message, envelope.data.result, context.chain.chainId, this.name);
    }
    if (typeof envelope.data.result !== "string" || !/^[0-9]+$/.test(envelope.data.result)) {
      throw invalidResponse(context, undefined, this.name);
    }
    try {
      return mapEtherscanBalance(envelope.data.result, context.chain, request.address, this.name);
    } catch (error: unknown) {
      throw invalidResponse(context, error, this.name);
    }
  }

  async getErc20Transfers(
    request: NormalizedErc20TransfersRequest,
    context: ProviderAttemptContext,
  ): Promise<ProviderPageResult<Erc20Transfer, EtherscanPageState>> {
    const page = readPageState(context.providerPageState, this.name);
    const body = await this.call("tokentx", {
      address: request.address,
      ...(request.tokenAddress === null ? {} : { contractaddress: request.tokenAddress }),
      page,
      offset: etherscanPageSize(request.pageSize),
      sort: request.order,
      ...(request.startBlock === null ? {} : { startblock: request.startBlock }),
      ...(request.endBlock === null ? {} : { endblock: request.endBlock }),
    }, context);
    const envelope = etherscanTokenTransferEnvelopeSchema.safeParse(body);
    if (!envelope.success) {
      throw invalidResponse(context, undefined, this.name);
    }
    if (envelope.data.status === "0") {
      if (isEmptyMessage(envelope.data.message, envelope.data.result, "transfers")) {
        return pageResult([], null, context, this.name);
      }
      throw classifyEtherscanEnvelopeError(envelope.data.message, envelope.data.result, context.chain.chainId, this.name);
    }
    if (!Array.isArray(envelope.data.result)) {
      throw invalidResponse(context, undefined, this.name);
    }
    try {
      const allItems = envelope.data.result.map((item) => mapEtherscanTokenTransfer(item, context.chain, this.name));
      const items = allItems.filter((item) => (
        request.direction === "both" ||
        request.direction === "incoming" && item.to === request.address ||
        request.direction === "outgoing" && item.from === request.address
      ));
      return pageResult(items, nextPage(allItems.length, etherscanPageSize(request.pageSize), page), context, this.name);
    } catch (error: unknown) {
      throw invalidResponse(context, error, this.name);
    }
  }

  async getErc20TransfersByBlockRangeWindow(
    request: NormalizedErc20BlockRangeRequest,
    context: ProviderAttemptContext,
  ): Promise<ProviderBlockRangeWindowResult> {
    const fetchPage = async (page: number): Promise<Erc20Transfer[]> => {
      const body = await this.call("tokentx", {
        address: request.address,
        ...(request.tokenAddress === null ? {} : { contractaddress: request.tokenAddress }),
        page,
        offset: ETHERSCAN_MAX_PAGE_SIZE,
        sort: "asc",
        startblock: request.startBlock,
        endblock: request.endBlock,
      }, context);
      const envelope = etherscanTokenTransferEnvelopeSchema.safeParse(body);
      if (!envelope.success) throw invalidResponse(context, undefined, this.name);
      if (envelope.data.status === "0") {
        if (isEmptyMessage(envelope.data.message, envelope.data.result, "transfers")) return [];
        throw classifyEtherscanEnvelopeError(envelope.data.message, envelope.data.result, context.chain.chainId, this.name);
      }
      if (!Array.isArray(envelope.data.result)) throw invalidResponse(context, undefined, this.name);
      try {
        return envelope.data.result.map((item) => mapEtherscanTokenTransfer(item, context.chain, this.name));
      } catch (error: unknown) {
        throw invalidResponse(context, error, this.name);
      }
    };

    const pages: Erc20Transfer[] = [];
    for (let page = 1; page <= 1_000; page += 1) {
      if (page > 1) await context.beforeProviderRequest?.();
      const current = await fetchPage(page);
      pages.push(...current);
      if (pages.length > 100_000) {
        throw new EvmDataError({
          code: "RANGE_RESULT_TOO_LARGE",
          message: "Indexed provider ERC-20 range exceeded the SDK record limit.",
          retryable: false,
          provider: this.name,
          chainId: context.chain.chainId,
        });
      }
      if (current.length < ETHERSCAN_MAX_PAGE_SIZE) {
        return completeRangePage(pages, request, context, this.name);
      }
    }
    throw new EvmDataError({
      code: "INVALID_PROVIDER_RESPONSE",
      message: "Indexed provider ERC-20 range exceeded the SDK page limit.",
      retryable: false,
      provider: this.name,
      chainId: context.chain.chainId,
    });
  }

  /**
   * Etherscan's indexed historical token-balance endpoint. This deliberately
   * accepts one explicit token contract at a time; it never expands a wallet
   * into a provider-owned token catalogue and never calls `eth_call`.
   */
  async getErc20BalanceAtBlock(
    request: { readonly address: string; readonly tokenAddress: string; readonly blockNumber: string },
    context: ProviderAttemptContext,
  ): Promise<Erc20BalanceAtBlock> {
    await this.throttleHistoricalBalanceApi(context.signal);
    const body = await this.call("tokenbalancehistory", {
      address: request.address,
      contractaddress: request.tokenAddress,
      blockno: request.blockNumber,
    }, context);
    const envelope = etherscanBalanceEnvelopeSchema.safeParse(body);
    if (!envelope.success) throw invalidResponse(context, undefined, this.name);
    if (envelope.data.status === "0") {
      throw classifyEtherscanStandardEndpointError(envelope.data.message, envelope.data.result, context.chain.chainId, this.name);
    }
    if (typeof envelope.data.result !== "string" || !/^[0-9]+$/.test(envelope.data.result)) {
      throw invalidResponse(context, undefined, this.name);
    }
    return {
      chainId: context.chain.chainId,
      address: request.address,
      tokenAddress: request.tokenAddress,
      blockNumber: BigInt(request.blockNumber).toString(),
      amount: BigInt(envelope.data.result).toString(),
      provider: this.name,
    };
  }

  /**
   * Current indexed holdings provide a contract set only. Callers must still
   * use `getErc20BalanceAtBlock` for any historical balance assertion.
   */
  async getErc20TokenHoldings(
    request: { readonly address: string },
    context: ProviderAttemptContext,
  ): Promise<Erc20TokenHoldings> {
    const items: Erc20TokenHolding[] = [];
    const seen = new Set<string>();
    let page = 1;
    for (; page <= 1_000; page += 1) {
      await this.throttleHistoricalBalanceApi(context.signal);
      const body = await this.call('addresstokenbalance', {
        address: request.address,
        page,
        offset: 100,
      }, context);
      const envelope = etherscanTokenHoldingEnvelopeSchema.safeParse(body);
      if (!envelope.success) throw invalidResponse(context, undefined, this.name);
      if (envelope.data.status === '0') {
        if (isEmptyMessage(envelope.data.message, envelope.data.result, 'transfers')) break;
        throw classifyEtherscanStandardEndpointError(envelope.data.message, envelope.data.result, context.chain.chainId, this.name);
      }
      if (!Array.isArray(envelope.data.result)) throw invalidResponse(context, undefined, this.name);
      try {
        for (const raw of envelope.data.result) {
          const item = mapEtherscanTokenHolding(raw, context.chain, request.address, this.name);
          if (seen.has(item.tokenAddress)) continue;
          seen.add(item.tokenAddress);
          items.push(item);
        }
      } catch (error: unknown) {
        throw invalidResponse(context, error, this.name);
      }
      if (envelope.data.result.length < 100) break;
      if (items.length > 100_000) {
        throw new EvmDataError({ code: 'INVALID_PROVIDER_RESPONSE', message: 'Indexed provider token holdings exceeded the SDK record limit.', retryable: false, provider: this.name, chainId: context.chain.chainId });
      }
    }
    if (page > 1_000) {
      throw new EvmDataError({ code: 'INVALID_PROVIDER_RESPONSE', message: 'Indexed provider token holdings exceeded the SDK page limit.', retryable: false, provider: this.name, chainId: context.chain.chainId });
    }
    return {
      chainId: context.chain.chainId,
      address: request.address,
      items,
      provider: this.name,
      pages: page,
      upstreamRequests: page,
    };
  }

  /**
   * Indexed explorer API only (`account/txlistinternal`); never uses trace or
   * JSON-RPC endpoints. The provider pagination stays inside the SDK.
   */
  async getInternalNativeTransfersByBlockRange(
    request: { readonly address: string; readonly startBlock: string; readonly endBlock: string },
    context: ProviderAttemptContext,
  ): Promise<InternalNativeTransferBlockRange> {
    const items: InternalNativeTransfer[] = [];
    const seen = new Set<string>();
    let page = 1;
    for (; page <= 1_000; page += 1) {
      const body = await this.call("txlistinternal", {
        address: request.address,
        page,
        offset: ETHERSCAN_MAX_PAGE_SIZE,
        sort: "asc",
        startblock: request.startBlock,
        endblock: request.endBlock,
      }, context);
      const envelope = etherscanInternalTransactionEnvelopeSchema.safeParse(body);
      if (!envelope.success) throw invalidResponse(context, undefined, this.name);
      if (envelope.data.status === "0") {
        if (isEmptyMessage(envelope.data.message, envelope.data.result, "internal transfers")) break;
        throw classifyEtherscanEnvelopeError(envelope.data.message, envelope.data.result, context.chain.chainId, this.name);
      }
      if (!Array.isArray(envelope.data.result)) throw invalidResponse(context, undefined, this.name);
      try {
        for (const raw of envelope.data.result) {
          const item = mapEtherscanInternalTransaction(raw, context.chain, this.name);
          if (item.from !== request.address && item.to !== request.address) continue;
          const key = `${item.transactionHash}:${item.traceId ?? ""}:${item.from}:${item.to}:${item.value}:${item.blockNumber}`;
          if (!seen.has(key)) {
            seen.add(key);
            items.push(item);
          }
        }
      } catch (error: unknown) {
        throw invalidResponse(context, error, this.name);
      }
      if (envelope.data.result.length < ETHERSCAN_MAX_PAGE_SIZE) break;
      if (items.length > 100_000) {
        throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Indexed provider internal range exceeded the SDK record limit.", retryable: false, provider: this.name, chainId: context.chain.chainId });
      }
    }
    if (page > 1_000) {
      throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Indexed provider internal range exceeded the SDK page limit.", retryable: false, provider: this.name, chainId: context.chain.chainId });
    }
    return {
      chainId: context.chain.chainId,
      address: request.address,
      range: { startBlock: request.startBlock, endBlock: request.endBlock },
      items,
      provider: this.name,
      pages: page,
      upstreamRequests: page,
    };
  }

  async getInternalNativeTransfersPage(
    request: { readonly address: string; readonly startBlock: string; readonly endBlock: string; readonly page: number },
    context: ProviderAttemptContext,
  ): Promise<import("../../domain/models").InternalNativeTransferPage> {
    const body = await this.call("txlistinternal", {
      address: request.address, page: request.page, offset: ETHERSCAN_MAX_PAGE_SIZE,
      sort: "asc", startblock: request.startBlock, endblock: request.endBlock,
    }, context);
    const envelope = etherscanInternalTransactionEnvelopeSchema.safeParse(body);
    if (!envelope.success) throw invalidResponse(context, undefined, this.name);
    if (envelope.data.status === "0") {
      if (isEmptyMessage(envelope.data.message, envelope.data.result, "internal transfers")) {
        return { chainId: context.chain.chainId, address: request.address, items: [], provider: this.name, page: request.page, hasNext: false };
      }
      throw classifyEtherscanEnvelopeError(envelope.data.message, envelope.data.result, context.chain.chainId, this.name);
    }
    if (!Array.isArray(envelope.data.result)) throw invalidResponse(context, undefined, this.name);
    const seen = new Set<string>();
    const items = envelope.data.result.map((raw) => mapEtherscanInternalTransaction(raw, context.chain, this.name))
      .filter((item) => {
        if (item.from !== request.address && item.to !== request.address) return false;
        const key = `${item.transactionHash}:${item.traceId ?? ""}:${item.from}:${item.to}:${item.value}:${item.blockNumber}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    return { chainId: context.chain.chainId, address: request.address, items, provider: this.name, page: request.page, hasNext: envelope.data.result.length >= ETHERSCAN_MAX_PAGE_SIZE };
  }

  /** EIP-4895 withdrawal history from Etherscan's indexed account endpoint. */
  async getBeaconWithdrawalsByBlockRange(
    request: { readonly address: string; readonly startBlock: string; readonly endBlock: string },
    context: ProviderAttemptContext,
  ): Promise<BeaconWithdrawalBlockRange> {
    if (context.chain.chainId !== 1) {
      throw new EvmDataError({ code: "UNSUPPORTED_CHAIN", message: "Beacon withdrawals are only available on Ethereum.", retryable: false, provider: this.name, chainId: context.chain.chainId });
    }
    const items: BeaconWithdrawal[] = [];
    const seen = new Set<string>();
    let page = 1;
    for (; page <= 1_000; page += 1) {
      const body = await this.call("txsBeaconWithdrawal", {
        address: request.address,
        page,
        offset: ETHERSCAN_MAX_PAGE_SIZE,
        sort: "asc",
        startblock: request.startBlock,
        endblock: request.endBlock,
      }, context);
      const envelope = etherscanBeaconWithdrawalEnvelopeSchema.safeParse(body);
      if (!envelope.success) throw invalidResponse(context, undefined, this.name);
      if (envelope.data.status === "0") {
        if (isEmptyMessage(envelope.data.message, envelope.data.result, "beacon withdrawals")) break;
        throw classifyEtherscanEnvelopeError(envelope.data.message, envelope.data.result, context.chain.chainId, this.name);
      }
      if (!Array.isArray(envelope.data.result)) throw invalidResponse(context, undefined, this.name);
      try {
        for (const raw of envelope.data.result) {
          const item = mapEtherscanBeaconWithdrawal(raw, context.chain, this.name);
          if (item.address !== request.address || seen.has(item.withdrawalIndex)) continue;
          seen.add(item.withdrawalIndex);
          items.push(item);
        }
      } catch (error: unknown) {
        throw invalidResponse(context, error, this.name);
      }
      if (envelope.data.result.length < ETHERSCAN_MAX_PAGE_SIZE) break;
      if (items.length > 100_000) {
        throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Indexed provider beacon range exceeded the SDK record limit.", retryable: false, provider: this.name, chainId: context.chain.chainId });
      }
    }
    if (page > 1_000) {
      throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Indexed provider beacon range exceeded the SDK page limit.", retryable: false, provider: this.name, chainId: context.chain.chainId });
    }
    return {
      chainId: context.chain.chainId,
      address: request.address,
      range: { startBlock: request.startBlock, endBlock: request.endBlock },
      items,
      provider: this.name,
      pages: page,
      upstreamRequests: page,
    };
  }

  async getBeaconWithdrawalsPage(
    request: { readonly address: string; readonly startBlock: string; readonly endBlock: string; readonly page: number },
    context: ProviderAttemptContext,
  ): Promise<import("../../domain/models").BeaconWithdrawalPage> {
    if (context.chain.chainId !== 1) throw new EvmDataError({ code: "UNSUPPORTED_CHAIN", message: "Beacon withdrawals are only available on Ethereum.", retryable: false, provider: this.name, chainId: context.chain.chainId });
    const body = await this.call("txsBeaconWithdrawal", {
      address: request.address, page: request.page, offset: ETHERSCAN_MAX_PAGE_SIZE,
      sort: "asc", startblock: request.startBlock, endblock: request.endBlock,
    }, context);
    const envelope = etherscanBeaconWithdrawalEnvelopeSchema.safeParse(body);
    if (!envelope.success) throw invalidResponse(context, undefined, this.name);
    if (envelope.data.status === "0") {
      if (isEmptyMessage(envelope.data.message, envelope.data.result, "beacon withdrawals")) return { chainId: context.chain.chainId, address: request.address, items: [], provider: this.name, page: request.page, hasNext: false };
      throw classifyEtherscanEnvelopeError(envelope.data.message, envelope.data.result, context.chain.chainId, this.name);
    }
    if (!Array.isArray(envelope.data.result)) throw invalidResponse(context, undefined, this.name);
    const seen = new Set<string>();
    const items = envelope.data.result.map((raw) => mapEtherscanBeaconWithdrawal(raw, context.chain, this.name))
      .filter((item) => {
        if (item.address !== request.address || seen.has(item.withdrawalIndex)) return false;
        seen.add(item.withdrawalIndex);
        return true;
      });
    return { chainId: context.chain.chainId, address: request.address, items, provider: this.name, page: request.page, hasNext: envelope.data.result.length >= ETHERSCAN_MAX_PAGE_SIZE };
  }

  /**
   * Explorer API lookup; this is intentionally not an RPC/proxy call.
   * Etherscan returns the closest canonical block at or before the supplied
   * Unix timestamp, which callers can combine with a configured finality lag.
   */
  async getBlockNumberByTimestamp(
    timestamp: string,
    context: ProviderAttemptContext,
  ): Promise<string> {
    if (!/^\d+$/.test(timestamp)) {
      throw new EvmDataError({
        code: 'INVALID_REQUEST',
        message: 'Timestamp must be a decimal Unix timestamp.',
        retryable: false,
        provider: this.name,
        chainId: context.chain.chainId,
      })
    }
    const route = this.routeFor(context.chain);
    if (route === undefined) {
      throw new EvmDataError({ code: 'UNSUPPORTED_CHAIN', message: 'Indexed provider does not support this chain.', retryable: false, provider: this.name, chainId: context.chain.chainId })
    }
    if (context.credential === null) {
      throw new EvmDataError({ code: 'AUTHENTICATION_FAILED', message: 'Indexed provider requires an API key.', retryable: false, provider: this.name, chainId: context.chain.chainId })
    }
    let response
    try {
      response = await this.transport.request({
        method: 'GET',
        url: this.endpointFor(context.chain),
        params: {
          module: 'block',
          action: 'getblocknobytime',
          timestamp,
          closest: 'before',
          ...(route.chainId === undefined ? {} : { chainid: route.chainId }),
          apikey: context.credential.value,
        },
        timeoutMs: context.timeoutMs,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
        proxy: context.proxy === null ? null : parseHttpProxyUrl(context.proxy.url),
      })
    } catch (error: unknown) {
      const normalized = normalizeEtherscanTransportError(error, context.chain.chainId, this.name)
      if (normalized !== null) throw normalized
      throw new EvmDataError({ code: 'PROVIDER_UNAVAILABLE', message: 'Indexed provider block lookup failed.', retryable: true, provider: this.name, chainId: context.chain.chainId })
    }
    const httpError = classifyEtherscanHttpResponse(response, context.chain.chainId, this.name)
    if (httpError !== null) throw httpError
    const body = response.body as { status?: unknown; message?: unknown; result?: unknown }
    if (body?.status === '0') {
      throw classifyEtherscanEnvelopeError(String(body.message ?? ''), body.result, context.chain.chainId, this.name)
    }
    // Blockscout's Etherscan-compatible endpoint wraps the block number as
    // `{ blockNumber: "..." }`, while Etherscan returns the decimal string
    // directly. Keep the normalization scoped to the Blockscout adapter so
    // malformed Etherscan responses remain rejected.
    const blockNumber = this.routeName === 'blockscout' &&
      typeof body?.result === 'object' && body.result !== null && !Array.isArray(body.result) &&
      typeof (body.result as { blockNumber?: unknown }).blockNumber === 'string'
      ? (body.result as { blockNumber: string }).blockNumber
      : body?.result
    if (typeof blockNumber !== 'string' || !/^\d+$/.test(blockNumber)) {
      throw invalidResponse(context, undefined, this.name)
    }
    return BigInt(blockNumber).toString()
  }

  private async call(
    action: "txlist" | "balance" | "tokentx" | "tokenbalancehistory" | "addresstokenbalance" | "txlistinternal" | "txsBeaconWithdrawal",
    params: Record<string, string | number | undefined>,
    context: ProviderAttemptContext,
  ): Promise<unknown> {
    const route = this.routeFor(context.chain);
    if (route === undefined) {
      throw new EvmDataError({
        code: "UNSUPPORTED_CHAIN",
        message: "Indexed provider does not support this chain.",
        retryable: false,
        provider: this.name,
        chainId: context.chain.chainId,
      });
    }
    if (context.credential === null) {
      throw new EvmDataError({
        code: "AUTHENTICATION_FAILED",
        message: "Indexed provider requires an API key.",
        retryable: false,
        provider: this.name,
        chainId: context.chain.chainId,
      });
    }
    let response;
    try {
      response = await this.transport.request({
        method: "GET",
        url: this.endpointFor(context.chain),
        params: {
          module: "account",
          action,
          ...(route.chainId === undefined ? {} : { chainid: route.chainId }),
          apikey: context.credential.value,
          ...params,
        },
        timeoutMs: context.timeoutMs,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
        proxy: context.proxy === null ? null : parseHttpProxyUrl(context.proxy.url),
      });
    } catch (error: unknown) {
      const normalized = normalizeEtherscanTransportError(error, context.chain.chainId, this.name);
      if (normalized !== null) {
        throw normalized;
      }
      throw new EvmDataError({
        code: "PROVIDER_UNAVAILABLE",
        message: "Indexed provider request failed.",
        retryable: true,
        provider: this.name,
        chainId: context.chain.chainId,
      });
    }
    const httpError = classifyEtherscanHttpResponse(response, context.chain.chainId, this.name);
    if (httpError !== null) {
      throw httpError;
    }
    return this.normalizeResponse(action, response.body);
  }

  /** Provider-specific aliases are normalized by adapters, before shared schemas. */
  protected normalizeResponse(action: string, body: unknown): unknown {
    return body;
  }

  protected async requestRaw(
    url: string,
    params: Record<string, string | number | undefined>,
    context: ProviderAttemptContext,
  ): Promise<unknown> {
    let response;
    try {
      response = await this.transport.request({
        method: "GET",
        url,
        params: { ...params, apikey: context.credential?.value },
        timeoutMs: context.timeoutMs,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
        proxy: context.proxy === null ? null : parseHttpProxyUrl(context.proxy.url),
      });
    } catch (error: unknown) {
      const normalized = normalizeEtherscanTransportError(error, context.chain.chainId, this.name);
      if (normalized !== null) throw normalized;
      throw new EvmDataError({ code: "PROVIDER_UNAVAILABLE", message: "Indexed provider request failed.", retryable: true, provider: this.name, chainId: context.chain.chainId });
    }
    const httpError = classifyEtherscanHttpResponse(response, context.chain.chainId, this.name);
    if (httpError !== null) throw httpError;
    return response.body;
  }

  private async throttleHistoricalBalanceApi(signal: AbortSignal | undefined): Promise<void> {
    if (signal?.aborted === true) {
      throw new EvmDataError({ code: 'REQUEST_ABORTED', message: 'Request was aborted.', retryable: false, provider: this.name });
    }
    const now = Date.now();
    const dueAt = Math.max(now, this.historicalBalanceNextAt);
    this.historicalBalanceNextAt = dueAt + 500;
    const waitMs = dueAt - now;
    if (waitMs <= 0) return;
    await new Promise<void>((resolvePromise, reject) => {
      const timeout = setTimeout(() => {
        signal?.removeEventListener('abort', abort);
        resolvePromise();
      }, waitMs);
      const abort = () => {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', abort);
        reject(new EvmDataError({ code: 'REQUEST_ABORTED', message: 'Request was aborted.', retryable: false, provider: this.name }));
      };
      signal?.addEventListener('abort', abort, { once: true });
    });
  }
}

function normalizeBaseUrl(value: string, allowInsecureHttp: boolean, provider: ProviderName): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${provider} base URL must be valid.`);
  }
  if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error(`${provider} base URL must not contain credentials or query parameters.`);
  }
  if (provider === "etherscan" && parsed.hostname.toLowerCase() === "api.etherscan.io" && (parsed.protocol !== "https:" || parsed.pathname !== "/v2/api")) {
    throw new Error("The official Etherscan endpoint must use HTTPS V2.");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && (allowInsecureHttp || isLoopbackHost(parsed.hostname)))) {
    throw new Error(`${provider} base URL must use HTTPS unless insecure HTTP is explicitly enabled.`);
  }
  return value.replace(/\/$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function readPageState(value: unknown, provider: ProviderName): number {
  if (value === null || value === undefined) {
    return 1;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Indexed provider page state is invalid.", retryable: false, provider });
  }
  const page = (value as { page?: unknown }).page;
  if (Object.keys(value).length !== 1 || typeof page !== "number" || !Number.isSafeInteger(page) || page < 1 || page > 1_000_000_000) {
    throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Indexed provider page state is invalid.", retryable: false, provider });
  }
  return page;
}

function nextPage(length: number, pageSize: number, page: number): EtherscanPageState | null {
  return length >= pageSize ? { page: page + 1 } : null;
}

function etherscanPageSize(requestedPageSize: number): number {
  return Math.min(requestedPageSize, ETHERSCAN_MAX_PAGE_SIZE);
}

function pageResult<T>(items: T[], nextPageState: EtherscanPageState | null, context: ProviderAttemptContext, provider: ProviderName): ProviderPageResult<T, EtherscanPageState> {
  return {
    items,
    nextPageState,
    pageInfo: { provider, chainId: context.chain.chainId },
  };
}

function directionMatches(
  item: Erc20Transfer,
  direction: NormalizedErc20BlockRangeRequest["direction"],
  address: string,
): boolean {
  return direction === "both" || direction === "incoming" && item.to === address || direction === "outgoing" && item.from === address;
}

function rangeItems(
  values: readonly Erc20Transfer[],
  request: NormalizedErc20BlockRangeRequest,
): ProviderBlockRangeItem[] {
  return values
    .filter((item) => directionMatches(item, request.direction, request.address))
    .map((item) => ({ item, identityKey: null }));
}

function completeRangePage(
  values: readonly Erc20Transfer[],
  request: NormalizedErc20BlockRangeRequest,
  context: ProviderAttemptContext,
  provider: ProviderName,
): ProviderBlockRangeWindowResult {
  return {
    items: rangeItems(values, request),
    // Etherscan's range pages are already deduplicated. Some valid responses
    // omit logIndex, so the generic scanner cannot require an event identity
    // a second time.
    itemsAlreadyDeduplicated: true,
    complete: true,
    pageInfo: { provider, chainId: context.chain.chainId },
  };
}

function invalidResponse(context: ProviderAttemptContext, cause?: unknown, provider: ProviderName = "etherscan"): EvmDataError {
  return new EvmDataError({
    code: "INVALID_PROVIDER_RESPONSE",
    message: "Indexed provider returned a malformed response.",
    retryable: false,
    provider,
    chainId: context.chain.chainId,
    ...(cause === undefined ? {} : { cause }),
  });
}

function isEmptyMessage(message: string, result: unknown, kind: "transactions" | "transfers" | "internal transfers" | "beacon withdrawals"): boolean {
  const normalized = `${message} ${typeof result === "string" ? result : ""}`.toLowerCase();
  return kind === "transactions"
    ? /no transactions found|no transaction found/.test(normalized)
    : /no transactions found|no token transfers found|no transfers found|no records found/.test(normalized);
}
