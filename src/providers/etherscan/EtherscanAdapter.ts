import { AxiosHttpTransport, parseHttpProxyUrl } from "../../transport/AxiosHttpTransport";
import type { HttpTransport } from "../../transport/HttpTransport";
import type {
  CapabilityRequest,
  DataProviderAdapter,
  ProviderBlockRangeWindowResult,
  ProviderAttemptContext,
} from "../DataProviderAdapter";
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
export const ETHERSCAN_MAX_PAGE_SIZE = MAX_PAGE_SIZE;

export interface EtherscanAdapterOptions {
  readonly transport?: HttpTransport;
  readonly baseUrl?: string;
  readonly allowInsecureHttp?: boolean;
}

interface EtherscanPageState {
  readonly page: number;
}

export class EtherscanAdapter implements DataProviderAdapter {
  readonly name = "etherscan" as const;

  private readonly transport: HttpTransport;
  private readonly baseUrl: string;
  /** Etherscan caps historical/holding PRO endpoints at two requests/second. */
  private historicalBalanceNextAt = 0;

  constructor(options: EtherscanAdapterOptions = {}) {
    this.transport = options.transport ?? new AxiosHttpTransport();
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? ETHERSCAN_V2_BASE_URL, options.allowInsecureHttp ?? false);
  }

  supports(request: CapabilityRequest): boolean {
    if (request.chain.routes.etherscan === undefined) return false;
    if (request.operation === "getNativeBalance") return true;
    if (request.operation === "getErc20TransfersByBlockRange") return true;
    return "pageSize" in request.request && request.request.pageSize <= ETHERSCAN_MAX_PAGE_SIZE;
  }

  async getTransactions(
    request: NormalizedTransactionsRequest,
    context: ProviderAttemptContext,
  ): Promise<ProviderPageResult<Transaction, EtherscanPageState>> {
    const page = readPageState(context.providerPageState);
    const body = await this.call("txlist", {
      address: request.address,
      page,
      offset: request.pageSize,
      sort: request.order,
      ...(request.startBlock === null ? {} : { startblock: request.startBlock }),
      ...(request.endBlock === null ? {} : { endblock: request.endBlock }),
    }, context);
    const envelope = etherscanTransactionListEnvelopeSchema.safeParse(body);
    if (!envelope.success) {
      throw invalidResponse(context);
    }
    if (envelope.data.status === "0") {
      if (isEmptyMessage(envelope.data.message, envelope.data.result, "transactions")) {
        return pageResult([], null, context);
      }
      throw classifyEtherscanEnvelopeError(envelope.data.message, envelope.data.result, context.chain.chainId);
    }
    if (!Array.isArray(envelope.data.result)) {
      throw invalidResponse(context);
    }
    try {
      const items = envelope.data.result.map((item) => mapEtherscanTransaction(item, context.chain));
      return pageResult(items, nextPage(items.length, request.pageSize, page), context);
    } catch (error: unknown) {
      throw invalidResponse(context, error);
    }
  }

  async getNativeBalance(
    request: NormalizedNativeBalanceRequest,
    context: ProviderAttemptContext,
  ): Promise<NativeBalance> {
    const body = await this.call("balance", { address: request.address, tag: "latest" }, context);
    const envelope = etherscanBalanceEnvelopeSchema.safeParse(body);
    if (!envelope.success) {
      throw invalidResponse(context);
    }
    if (envelope.data.status === "0") {
      throw classifyEtherscanEnvelopeError(envelope.data.message, envelope.data.result, context.chain.chainId);
    }
    if (typeof envelope.data.result !== "string" || !/^[0-9]+$/.test(envelope.data.result)) {
      throw invalidResponse(context);
    }
    try {
      return mapEtherscanBalance(envelope.data.result, context.chain, request.address);
    } catch (error: unknown) {
      throw invalidResponse(context, error);
    }
  }

  async getErc20Transfers(
    request: NormalizedErc20TransfersRequest,
    context: ProviderAttemptContext,
  ): Promise<ProviderPageResult<Erc20Transfer, EtherscanPageState>> {
    const page = readPageState(context.providerPageState);
    const body = await this.call("tokentx", {
      address: request.address,
      ...(request.tokenAddress === null ? {} : { contractaddress: request.tokenAddress }),
      page,
      offset: request.pageSize,
      sort: request.order,
      ...(request.startBlock === null ? {} : { startblock: request.startBlock }),
      ...(request.endBlock === null ? {} : { endblock: request.endBlock }),
    }, context);
    const envelope = etherscanTokenTransferEnvelopeSchema.safeParse(body);
    if (!envelope.success) {
      throw invalidResponse(context);
    }
    if (envelope.data.status === "0") {
      if (isEmptyMessage(envelope.data.message, envelope.data.result, "transfers")) {
        return pageResult([], null, context);
      }
      throw classifyEtherscanEnvelopeError(envelope.data.message, envelope.data.result, context.chain.chainId);
    }
    if (!Array.isArray(envelope.data.result)) {
      throw invalidResponse(context);
    }
    try {
      const allItems = envelope.data.result.map((item) => mapEtherscanTokenTransfer(item, context.chain));
      const items = allItems.filter((item) => (
        request.direction === "both" ||
        request.direction === "incoming" && item.to === request.address ||
        request.direction === "outgoing" && item.from === request.address
      ));
      return pageResult(items, nextPage(allItems.length, request.pageSize, page), context);
    } catch (error: unknown) {
      throw invalidResponse(context, error);
    }
  }

  async getErc20TransfersByBlockRangeWindow(
    request: NormalizedErc20BlockRangeRequest,
    context: ProviderAttemptContext,
  ): Promise<ProviderBlockRangeWindowResult> {
    const body = await this.call("tokentx", {
      address: request.address,
      ...(request.tokenAddress === null ? {} : { contractaddress: request.tokenAddress }),
      page: 1,
      offset: ETHERSCAN_MAX_PAGE_SIZE,
      sort: "asc",
      startblock: request.startBlock,
      endblock: request.endBlock,
    }, context);
    const envelope = etherscanTokenTransferEnvelopeSchema.safeParse(body);
    if (!envelope.success) throw invalidResponse(context);
    if (envelope.data.status === "0") {
      if (isEmptyMessage(envelope.data.message, envelope.data.result, "transfers")) {
        return { items: [], complete: true, pageInfo: { provider: this.name, chainId: context.chain.chainId } };
      }
      throw classifyEtherscanEnvelopeError(envelope.data.message, envelope.data.result, context.chain.chainId);
    }
    if (!Array.isArray(envelope.data.result)) throw invalidResponse(context);
    try {
      const mapped = envelope.data.result.map((item) => mapEtherscanTokenTransfer(item, context.chain));
      return {
        items: mapped
          .filter((item) => directionMatches(item, request.direction, request.address))
          .map((item) => ({ item, identityKey: null })),
        // The Etherscan range endpoint returns an already-deduplicated list.
        // Some valid responses omit logIndex, so no event identity can be
        // required a second time by the generic scanner.
        itemsAlreadyDeduplicated: true,
        complete: mapped.length < ETHERSCAN_MAX_PAGE_SIZE,
        pageInfo: { provider: this.name, chainId: context.chain.chainId },
      };
    } catch (error: unknown) {
      throw invalidResponse(context, error);
    }
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
    if (!envelope.success) throw invalidResponse(context);
    if (envelope.data.status === "0") {
      throw classifyEtherscanStandardEndpointError(envelope.data.message, envelope.data.result, context.chain.chainId);
    }
    if (typeof envelope.data.result !== "string" || !/^[0-9]+$/.test(envelope.data.result)) {
      throw invalidResponse(context);
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
      if (!envelope.success) throw invalidResponse(context);
      if (envelope.data.status === '0') {
        if (isEmptyMessage(envelope.data.message, envelope.data.result, 'transfers')) break;
        throw classifyEtherscanStandardEndpointError(envelope.data.message, envelope.data.result, context.chain.chainId);
      }
      if (!Array.isArray(envelope.data.result)) throw invalidResponse(context);
      try {
        for (const raw of envelope.data.result) {
          const item = mapEtherscanTokenHolding(raw, context.chain, request.address);
          if (seen.has(item.tokenAddress)) continue;
          seen.add(item.tokenAddress);
          items.push(item);
        }
      } catch (error: unknown) {
        throw invalidResponse(context, error);
      }
      if (envelope.data.result.length < 100) break;
      if (items.length > 100_000) {
        throw new EvmDataError({ code: 'INVALID_PROVIDER_RESPONSE', message: 'Etherscan token holdings exceeded the SDK record limit.', retryable: false, provider: this.name, chainId: context.chain.chainId });
      }
    }
    if (page > 1_000) {
      throw new EvmDataError({ code: 'INVALID_PROVIDER_RESPONSE', message: 'Etherscan token holdings exceeded the SDK page limit.', retryable: false, provider: this.name, chainId: context.chain.chainId });
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
      if (!envelope.success) throw invalidResponse(context);
      if (envelope.data.status === "0") {
        if (isEmptyMessage(envelope.data.message, envelope.data.result, "internal transfers")) break;
        throw classifyEtherscanEnvelopeError(envelope.data.message, envelope.data.result, context.chain.chainId);
      }
      if (!Array.isArray(envelope.data.result)) throw invalidResponse(context);
      try {
        for (const raw of envelope.data.result) {
          const item = mapEtherscanInternalTransaction(raw, context.chain);
          if (item.from !== request.address && item.to !== request.address) continue;
          const key = `${item.transactionHash}:${item.traceId ?? ""}:${item.from}:${item.to}:${item.value}:${item.blockNumber}`;
          if (!seen.has(key)) {
            seen.add(key);
            items.push(item);
          }
        }
      } catch (error: unknown) {
        throw invalidResponse(context, error);
      }
      if (envelope.data.result.length < ETHERSCAN_MAX_PAGE_SIZE) break;
      if (items.length > 100_000) {
        throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Etherscan internal range exceeded the SDK record limit.", retryable: false, provider: this.name, chainId: context.chain.chainId });
      }
    }
    if (page > 1_000) {
      throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Etherscan internal range exceeded the SDK page limit.", retryable: false, provider: this.name, chainId: context.chain.chainId });
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
      if (!envelope.success) throw invalidResponse(context);
      if (envelope.data.status === "0") {
        if (isEmptyMessage(envelope.data.message, envelope.data.result, "beacon withdrawals")) break;
        throw classifyEtherscanEnvelopeError(envelope.data.message, envelope.data.result, context.chain.chainId);
      }
      if (!Array.isArray(envelope.data.result)) throw invalidResponse(context);
      try {
        for (const raw of envelope.data.result) {
          const item = mapEtherscanBeaconWithdrawal(raw, context.chain);
          if (item.address !== request.address || seen.has(item.withdrawalIndex)) continue;
          seen.add(item.withdrawalIndex);
          items.push(item);
        }
      } catch (error: unknown) {
        throw invalidResponse(context, error);
      }
      if (envelope.data.result.length < ETHERSCAN_MAX_PAGE_SIZE) break;
      if (items.length > 100_000) {
        throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Etherscan beacon range exceeded the SDK record limit.", retryable: false, provider: this.name, chainId: context.chain.chainId });
      }
    }
    if (page > 1_000) {
      throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Etherscan beacon range exceeded the SDK page limit.", retryable: false, provider: this.name, chainId: context.chain.chainId });
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
    const route = context.chain.routes.etherscan
    if (route === undefined) {
      throw new EvmDataError({ code: 'UNSUPPORTED_CHAIN', message: 'Etherscan does not support this chain.', retryable: false, provider: this.name, chainId: context.chain.chainId })
    }
    if (context.credential === null) {
      throw new EvmDataError({ code: 'AUTHENTICATION_FAILED', message: 'Etherscan requires an API key.', retryable: false, provider: this.name, chainId: context.chain.chainId })
    }
    let response
    try {
      response = await this.transport.request({
        method: 'GET',
        url: this.baseUrl,
        params: {
          module: 'block',
          action: 'getblocknobytime',
          timestamp,
          closest: 'before',
          chainid: route.chainId,
          apikey: context.credential.value,
        },
        timeoutMs: context.timeoutMs,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
        proxy: context.proxy === null ? null : parseHttpProxyUrl(context.proxy.url),
      })
    } catch (error: unknown) {
      const normalized = normalizeEtherscanTransportError(error, context.chain.chainId)
      if (normalized !== null) throw normalized
      throw new EvmDataError({ code: 'PROVIDER_UNAVAILABLE', message: 'Etherscan block lookup failed.', retryable: true, provider: this.name, chainId: context.chain.chainId })
    }
    const httpError = classifyEtherscanHttpResponse(response, context.chain.chainId)
    if (httpError !== null) throw httpError
    const body = response.body as { status?: unknown; message?: unknown; result?: unknown }
    if (body?.status === '0') {
      throw classifyEtherscanEnvelopeError(String(body.message ?? ''), body.result, context.chain.chainId)
    }
    if (typeof body?.result !== 'string' || !/^\d+$/.test(body.result)) {
      throw invalidResponse(context)
    }
    return BigInt(body.result).toString()
  }

  private async call(
    action: "txlist" | "balance" | "tokentx" | "tokenbalancehistory" | "addresstokenbalance" | "txlistinternal" | "txsBeaconWithdrawal",
    params: Record<string, string | number | undefined>,
    context: ProviderAttemptContext,
  ): Promise<unknown> {
    const route = context.chain.routes.etherscan;
    if (route === undefined) {
      throw new EvmDataError({
        code: "UNSUPPORTED_CHAIN",
        message: "Etherscan does not support this chain.",
        retryable: false,
        provider: this.name,
        chainId: context.chain.chainId,
      });
    }
    if (context.credential === null) {
      throw new EvmDataError({
        code: "AUTHENTICATION_FAILED",
        message: "Etherscan requires an API key.",
        retryable: false,
        provider: this.name,
        chainId: context.chain.chainId,
      });
    }
    let response;
    try {
      response = await this.transport.request({
        method: "GET",
        url: this.baseUrl,
        params: {
          module: "account",
          action,
          chainid: route.chainId,
          apikey: context.credential.value,
          ...params,
        },
        timeoutMs: context.timeoutMs,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
        proxy: context.proxy === null ? null : parseHttpProxyUrl(context.proxy.url),
      });
    } catch (error: unknown) {
      const normalized = normalizeEtherscanTransportError(error, context.chain.chainId);
      if (normalized !== null) {
        throw normalized;
      }
      throw new EvmDataError({
        code: "PROVIDER_UNAVAILABLE",
        message: "Etherscan request failed.",
        retryable: true,
        provider: this.name,
        chainId: context.chain.chainId,
      });
    }
    const httpError = classifyEtherscanHttpResponse(response, context.chain.chainId);
    if (httpError !== null) {
      throw httpError;
    }
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

function normalizeBaseUrl(value: string, allowInsecureHttp: boolean): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Etherscan base URL must be valid.");
  }
  if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Etherscan base URL must not contain credentials or query parameters.");
  }
  if (parsed.hostname.toLowerCase() === "api.etherscan.io" && (parsed.protocol !== "https:" || parsed.pathname !== "/v2/api")) {
    throw new Error("The official Etherscan endpoint must use HTTPS V2.");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && (allowInsecureHttp || isLoopbackHost(parsed.hostname)))) {
    throw new Error("Etherscan base URL must use HTTPS unless insecure HTTP is explicitly enabled.");
  }
  return value.replace(/\/$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function readPageState(value: unknown): number {
  if (value === null || value === undefined) {
    return 1;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Etherscan page state is invalid.", retryable: false, provider: "etherscan" });
  }
  const page = (value as { page?: unknown }).page;
  if (Object.keys(value).length !== 1 || typeof page !== "number" || !Number.isSafeInteger(page) || page < 1 || page > 1_000_000_000) {
    throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Etherscan page state is invalid.", retryable: false, provider: "etherscan" });
  }
  return page;
}

function nextPage(length: number, pageSize: number, page: number): EtherscanPageState | null {
  return length >= pageSize ? { page: page + 1 } : null;
}

function pageResult<T>(items: T[], nextPageState: EtherscanPageState | null, context: ProviderAttemptContext): ProviderPageResult<T, EtherscanPageState> {
  return {
    items,
    nextPageState,
    pageInfo: { provider: "etherscan", chainId: context.chain.chainId },
  };
}

function directionMatches(
  item: Erc20Transfer,
  direction: NormalizedErc20BlockRangeRequest["direction"],
  address: string,
): boolean {
  return direction === "both" || direction === "incoming" && item.to === address || direction === "outgoing" && item.from === address;
}

function invalidResponse(context: ProviderAttemptContext, cause?: unknown): EvmDataError {
  return new EvmDataError({
    code: "INVALID_PROVIDER_RESPONSE",
    message: "Etherscan returned a malformed response.",
    retryable: false,
    provider: "etherscan",
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
