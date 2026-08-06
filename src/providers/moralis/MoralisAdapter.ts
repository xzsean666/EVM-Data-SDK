import { AxiosHttpTransport, parseHttpProxyUrl } from "../../transport/AxiosHttpTransport";
import type { HttpTransport } from "../../transport/HttpTransport";
import { EvmDataError } from "../../domain/errors";
import type { Erc20Transfer, NativeBalance, Transaction } from "../../domain/models";
import type {
  NormalizedErc20TransfersRequest,
  NormalizedNativeBalanceRequest,
  NormalizedTransactionsRequest,
} from "../../domain/operations";
import type { ProviderPageResult } from "../../domain/pagination";
import type {
  CapabilityRequest,
  DataProviderAdapter,
  ProviderAttemptContext,
} from "../DataProviderAdapter";
import {
  classifyMoralisHttpResponse,
  normalizeMoralisTransportError,
} from "./moralisErrors";
import {
  moralisNativeBalanceSchema,
  moralisTokenTransferCollectionSchema,
  moralisTransactionCollectionSchema,
} from "./moralisSchemas";
import {
  mapMoralisNativeBalance,
  mapMoralisTokenTransfer,
  mapMoralisTransaction,
} from "./moralisMapper";

export const MORALIS_V2_BASE_URL = "https://deep-index.moralis.io/api/v2.2";
export const MORALIS_MAX_PAGE_SIZE = 100;

export interface MoralisAdapterOptions {
  readonly transport?: HttpTransport;
  readonly baseUrl?: string;
  readonly allowInsecureHttp?: boolean;
}

interface MoralisPageState {
  readonly cursor: string;
}

export class MoralisAdapter implements DataProviderAdapter {
  readonly name = "moralis" as const;

  private readonly transport: HttpTransport;
  private readonly baseUrl: string;

  constructor(options: MoralisAdapterOptions = {}) {
    this.transport = options.transport ?? new AxiosHttpTransport();
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? MORALIS_V2_BASE_URL, options.allowInsecureHttp ?? false);
  }

  supports(request: CapabilityRequest): boolean {
    if (request.chain.routes.moralis === undefined) return false;
    if (request.operation === "getNativeBalance") return true;
    return "pageSize" in request.request && request.request.pageSize <= MORALIS_MAX_PAGE_SIZE;
  }

  async getTransactions(
    request: NormalizedTransactionsRequest,
    context: ProviderAttemptContext,
  ): Promise<ProviderPageResult<Transaction, MoralisPageState>> {
    const cursor = readPageState(context.providerPageState);
    const body = await this.call(`/${request.address}`, {
      ...listParams(request, context, cursor),
    }, context);
    const parsed = moralisTransactionCollectionSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidResponse(context);
    }
    try {
      const items = parsed.data.result.map((item) => mapMoralisTransaction(item, context.chain));
      return pageResult(items, nextPageState(parsed.data.cursor, cursor), context);
    } catch (error: unknown) {
      throw invalidResponse(context, error);
    }
  }

  async getNativeBalance(
    request: NormalizedNativeBalanceRequest,
    context: ProviderAttemptContext,
  ): Promise<NativeBalance> {
    const body = await this.call(`/${request.address}/balance`, { chain: moralisChain(context) }, context);
    const parsed = moralisNativeBalanceSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidResponse(context);
    }
    try {
      return mapMoralisNativeBalance(parsed.data, context.chain, request.address);
    } catch (error: unknown) {
      throw invalidResponse(context, error);
    }
  }

  async getErc20Transfers(
    request: NormalizedErc20TransfersRequest,
    context: ProviderAttemptContext,
  ): Promise<ProviderPageResult<Erc20Transfer, MoralisPageState>> {
    const cursor = readPageState(context.providerPageState);
    const body = await this.call(`/${request.address}/erc20/transfers`, {
      ...listParams(request, context, cursor),
      ...(request.tokenAddress === null ? {} : { contract_addresses: request.tokenAddress }),
    }, context);
    const parsed = moralisTokenTransferCollectionSchema.safeParse(body);
    if (!parsed.success) {
      throw invalidResponse(context);
    }
    try {
      const allItems = parsed.data.result.map((item) => mapMoralisTokenTransfer(item, context.chain));
      const items = allItems.filter((item) => (
        request.direction === "both" ||
        request.direction === "incoming" && item.to === request.address ||
        request.direction === "outgoing" && item.from === request.address
      ));
      return pageResult(items, nextPageState(parsed.data.cursor, cursor), context);
    } catch (error: unknown) {
      throw invalidResponse(context, error);
    }
  }

  private async call(
    path: string,
    params: Record<string, string | number | undefined>,
    context: ProviderAttemptContext,
  ): Promise<unknown> {
    const route = context.chain.routes.moralis;
    if (route === undefined) {
      throw new EvmDataError({
        code: "UNSUPPORTED_CHAIN",
        message: "Moralis does not support this chain.",
        retryable: false,
        provider: this.name,
        chainId: context.chain.chainId,
      });
    }
    if (context.credential === null) {
      throw new EvmDataError({
        code: "AUTHENTICATION_FAILED",
        message: "Moralis requires an API key.",
        retryable: false,
        provider: this.name,
        chainId: context.chain.chainId,
      });
    }

    let response;
    try {
      response = await this.transport.request({
        method: "GET",
        url: `${this.baseUrl}${path}`,
        headers: { "X-API-Key": context.credential.value },
        params,
        timeoutMs: context.timeoutMs,
        ...(context.signal === undefined ? {} : { signal: context.signal }),
        proxy: context.proxy === null ? null : parseHttpProxyUrl(context.proxy.url),
      });
    } catch (error: unknown) {
      const normalized = normalizeMoralisTransportError(error, context.chain.chainId);
      if (normalized !== null) {
        throw normalized;
      }
      throw new EvmDataError({
        code: "PROVIDER_UNAVAILABLE",
        message: "Moralis request failed.",
        retryable: true,
        provider: this.name,
        chainId: context.chain.chainId,
      });
    }
    const httpError = classifyMoralisHttpResponse(response, context.chain.chainId);
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
    throw new Error("Moralis base URL must be valid.");
  }
  if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") {
    throw new Error("Moralis base URL must not contain credentials or query parameters.");
  }
  if (parsed.hostname.toLowerCase() === "deep-index.moralis.io" && (parsed.protocol !== "https:" || parsed.pathname !== "/api/v2.2")) {
    throw new Error("The official Moralis endpoint must use HTTPS v2.2.");
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && (allowInsecureHttp || isLoopbackHost(parsed.hostname)))) {
    throw new Error("Moralis base URL must use HTTPS unless insecure HTTP is explicitly enabled.");
  }
  return value.replace(/\/$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}

function listParams(
  request: NormalizedTransactionsRequest | NormalizedErc20TransfersRequest,
  context: ProviderAttemptContext,
  cursor: string | null,
): Record<string, string | number | undefined> {
  return {
    chain: moralisChain(context),
    limit: request.pageSize,
    order: request.order.toUpperCase(),
    ...(cursor === null ? {} : { cursor }),
    ...(request.startBlock === null ? {} : { from_block: request.startBlock }),
    ...(request.endBlock === null ? {} : { to_block: request.endBlock }),
  };
}

function moralisChain(context: ProviderAttemptContext): string {
  const route = context.chain.routes.moralis;
  if (route === undefined) {
    throw new EvmDataError({
      code: "UNSUPPORTED_CHAIN",
      message: "Moralis does not support this chain.",
      retryable: false,
      provider: "moralis",
      chainId: context.chain.chainId,
    });
  }
  return route.chain;
}

function readPageState(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 1) {
    throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Moralis page state is invalid.", retryable: false, provider: "moralis" });
  }
  const cursor = (value as { cursor?: unknown }).cursor;
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 2048 || /^https?:\/\//i.test(cursor)) {
    throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Moralis page state is invalid.", retryable: false, provider: "moralis" });
  }
  return cursor;
}

function nextPageState(value: string | null | undefined, previous: string | null): MoralisPageState | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (value === previous) {
    throw new Error("Moralis returned the same pagination cursor twice.");
  }
  return { cursor: value };
}

function pageResult<T>(items: T[], nextPageStateValue: MoralisPageState | null, context: ProviderAttemptContext): ProviderPageResult<T, MoralisPageState> {
  return {
    items,
    nextPageState: nextPageStateValue,
    pageInfo: { provider: "moralis", chainId: context.chain.chainId },
  };
}

function invalidResponse(context: ProviderAttemptContext, cause?: unknown): EvmDataError {
  return new EvmDataError({
    code: "INVALID_PROVIDER_RESPONSE",
    message: "Moralis returned a malformed response.",
    retryable: false,
    provider: "moralis",
    chainId: context.chain.chainId,
    ...(cause === undefined ? {} : { cause }),
  });
}
