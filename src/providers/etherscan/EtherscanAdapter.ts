import { AxiosHttpTransport, parseHttpProxyUrl } from "../../transport/AxiosHttpTransport";
import type { HttpTransport } from "../../transport/HttpTransport";
import type {
  CapabilityRequest,
  DataProviderAdapter,
  ProviderAttemptContext,
} from "../DataProviderAdapter";
import type {
  NormalizedErc20TransfersRequest,
  NormalizedNativeBalanceRequest,
  NormalizedTransactionsRequest,
} from "../../domain/operations";
import type { ProviderPageResult } from "../../domain/pagination";
import type { Erc20Transfer, NativeBalance, Transaction } from "../../domain/models";
import { EvmDataError } from "../../domain/errors";
import {
  classifyEtherscanEnvelopeError,
  classifyEtherscanHttpResponse,
  normalizeEtherscanTransportError,
} from "./etherscanErrors";
import {
  etherscanBalanceEnvelopeSchema,
  etherscanTokenTransferEnvelopeSchema,
  etherscanTransactionListEnvelopeSchema,
} from "./etherscanSchemas";
import {
  mapEtherscanBalance,
  mapEtherscanTokenTransfer,
  mapEtherscanTransaction,
} from "./etherscanMapper";

export const ETHERSCAN_V2_BASE_URL = "https://api.etherscan.io/v2/api";

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

  constructor(options: EtherscanAdapterOptions = {}) {
    this.transport = options.transport ?? new AxiosHttpTransport();
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? ETHERSCAN_V2_BASE_URL, options.allowInsecureHttp ?? false);
  }

  supports(request: CapabilityRequest): boolean {
    return request.chain.routes.etherscan !== undefined && (
      request.operation === "getTransactions" ||
      request.operation === "getNativeBalance" ||
      request.operation === "getErc20Transfers"
    );
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

  private async call(
    action: "txlist" | "balance" | "tokentx",
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

function isEmptyMessage(message: string, result: unknown, kind: "transactions" | "transfers"): boolean {
  const normalized = `${message} ${typeof result === "string" ? result : ""}`.toLowerCase();
  return kind === "transactions"
    ? /no transactions found|no transaction found/.test(normalized)
    : /no transactions found|no token transfers found|no transfers found/.test(normalized);
}
