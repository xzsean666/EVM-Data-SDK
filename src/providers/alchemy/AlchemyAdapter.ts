import { AxiosHttpTransport, parseHttpProxyUrl } from "../../transport/AxiosHttpTransport";
import type { HttpTransport } from "../../transport/HttpTransport";
import { EvmDataError } from "../../domain/errors";
import type { Erc20Transfer, NativeBalance } from "../../domain/models";
import type { NormalizedErc20TransfersRequest, NormalizedNativeBalanceRequest, NormalizedTransactionsRequest } from "../../domain/operations";
import type { ProviderPageResult } from "../../domain/pagination";
import type { CapabilityRequest, DataProviderAdapter, ProviderAttemptContext } from "../DataProviderAdapter";
import { classifyAlchemyHttpResponse, classifyAlchemyJsonRpcError, normalizeAlchemyTransportError } from "./alchemyErrors";
import { alchemyBalanceResultSchema, alchemyJsonRpcResponseSchema, alchemyTransfersResultSchema } from "./alchemySchemas";
import { mapAlchemyBalance, mapAlchemyTransfer } from "./alchemyMapper";

export interface AlchemyAdapterOptions {
  readonly transport?: HttpTransport;
  readonly baseUrl?: string;
  readonly allowInsecureHttp?: boolean;
}

interface AlchemyPageState {
  readonly pageKey: string;
}

export class AlchemyAdapter implements DataProviderAdapter {
  readonly name = "alchemy" as const;
  private readonly transport: HttpTransport;
  private readonly baseUrlOverride: string | undefined;

  constructor(options: AlchemyAdapterOptions = {}) {
    this.transport = options.transport ?? new AxiosHttpTransport();
    this.baseUrlOverride = options.baseUrl === undefined
      ? undefined
      : normalizeBaseUrl(options.baseUrl, options.allowInsecureHttp ?? false);
  }

  supports(request: CapabilityRequest): boolean {
    if (request.chain.routes.alchemy === undefined) return false;
    if (request.operation === "getNativeBalance") return true;
    if (request.operation === "getErc20Transfers" && "direction" in request.request) return request.request.direction !== "both";
    return false;
  }

  async getNativeBalance(request: NormalizedNativeBalanceRequest, context: ProviderAttemptContext): Promise<NativeBalance> {
    const body = await this.call("eth_getBalance", [request.address, "latest"], context);
    const result = parseResult(body, context);
    const parsed = alchemyBalanceResultSchema.safeParse(result);
    if (!parsed.success) throw invalidResponse(context);
    try {
      return mapAlchemyBalance(parsed.data, context.chain, request.address);
    } catch (error: unknown) {
      throw invalidResponse(context, error);
    }
  }

  async getErc20Transfers(request: NormalizedErc20TransfersRequest, context: ProviderAttemptContext): Promise<ProviderPageResult<Erc20Transfer, AlchemyPageState>> {
    if (request.direction === "both") {
      throw new EvmDataError({ code: "UNSUPPORTED_OPERATION", message: "Alchemy requires one transfer direction.", retryable: false, provider: this.name, chainId: context.chain.chainId });
    }
    const pageState = readPageState(context.providerPageState);
    const filter: Record<string, unknown> = {
      category: ["erc20"],
      withMetadata: true,
      excludeZeroValue: false,
      order: request.order,
      maxCount: `0x${request.pageSize.toString(16)}`,
      ...(request.direction === "incoming" ? { toAddress: request.address } : { fromAddress: request.address }),
      ...(request.tokenAddress === null ? {} : { contractAddresses: [request.tokenAddress] }),
      ...(request.startBlock === null ? { fromBlock: "0x0" } : { fromBlock: decimalToHex(request.startBlock) }),
      ...(request.endBlock === null ? { toBlock: "latest" } : { toBlock: decimalToHex(request.endBlock) }),
      ...(pageState === null ? {} : { pageKey: pageState.pageKey }),
    };
    const body = await this.call("alchemy_getAssetTransfers", [filter], context);
    const result = alchemyTransfersResultSchema.safeParse(parseResult(body, context));
    if (!result.success) throw invalidResponse(context);
    try {
      const allItems = result.data.transfers.map((item) => mapAlchemyTransfer(item, context.chain));
      const items = allItems.filter((item) => (
        request.direction === "incoming" && item.to === request.address ||
        request.direction === "outgoing" && item.from === request.address
      ));
      const nextPageKey = result.data.pageKey === undefined || result.data.pageKey === null ? null : result.data.pageKey;
      if (nextPageKey !== null && pageState !== null && nextPageKey === pageState.pageKey) {
        throw new Error("Alchemy returned the same pagination page key twice.");
      }
      return { items, nextPageState: nextPageKey === null ? null : { pageKey: nextPageKey }, pageInfo: { provider: this.name, chainId: context.chain.chainId } };
    } catch (error: unknown) {
      throw invalidResponse(context, error);
    }
  }

  private async call(method: string, params: readonly unknown[], context: ProviderAttemptContext): Promise<unknown> {
    const route = context.chain.routes.alchemy;
    if (route === undefined) throw new EvmDataError({ code: "UNSUPPORTED_CHAIN", message: "Alchemy does not support this chain.", retryable: false, provider: this.name, chainId: context.chain.chainId });
    if (context.credential === null) throw new EvmDataError({ code: "AUTHENTICATION_FAILED", message: "Alchemy requires an API key.", retryable: false, provider: this.name, chainId: context.chain.chainId });
    let response;
    try {
      response = await this.transport.request({ method: "POST", url: this.baseUrlOverride ?? route.httpUrlPrefix, headers: { Authorization: `Bearer ${context.credential.value}`, "content-type": "application/json" }, body: { jsonrpc: "2.0", id: 1, method, params }, timeoutMs: context.timeoutMs, ...(context.signal === undefined ? {} : { signal: context.signal }), proxy: context.proxy === null ? null : parseHttpProxyUrl(context.proxy.url) });
    } catch (error: unknown) {
      const normalized = normalizeAlchemyTransportError(error, context.chain.chainId);
      if (normalized !== null) throw normalized;
      throw new EvmDataError({ code: "PROVIDER_UNAVAILABLE", message: "Alchemy request failed.", retryable: true, provider: this.name, chainId: context.chain.chainId });
    }
    const httpError = classifyAlchemyHttpResponse(response, context.chain.chainId);
    if (httpError !== null) throw httpError;
    const parsed = alchemyJsonRpcResponseSchema.safeParse(response.body);
    if (!parsed.success) throw invalidResponse(context);
    if (parsed.data.error !== undefined) throw classifyAlchemyJsonRpcError(parsed.data.error.code, parsed.data.error.message, context.chain.chainId);
    if (!("result" in parsed.data) || parsed.data.result === undefined) throw invalidResponse(context);
    return parsed.data;
  }
}

function parseResult(body: unknown, context: ProviderAttemptContext): unknown {
  const parsed = alchemyJsonRpcResponseSchema.safeParse(body);
  if (!parsed.success || parsed.data.error !== undefined || !("result" in parsed.data)) throw invalidResponse(context);
  return parsed.data.result;
}

function invalidResponse(context: ProviderAttemptContext, cause?: unknown): EvmDataError {
  return new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Alchemy returned an invalid response.", retryable: false, provider: "alchemy", chainId: context.chain.chainId, ...(cause === undefined ? {} : { cause }) });
}

function readPageState(value: unknown): AlchemyPageState | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value) || value === null) throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Alchemy page state is invalid.", retryable: false, provider: "alchemy" });
  const pageKey = (value as { pageKey?: unknown }).pageKey;
  if (Object.keys(value).length !== 1 || typeof pageKey !== "string" || pageKey.length === 0 || pageKey.length > 2048 || /^https?:\/\//i.test(pageKey)) throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Alchemy page state is invalid.", retryable: false, provider: "alchemy" });
  return { pageKey };
}

function decimalToHex(value: string): string {
  return `0x${BigInt(value).toString(16)}`;
}

function normalizeBaseUrl(value: string, allowInsecureHttp: boolean): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("Alchemy base URL must be valid."); }
  if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "" || parsed.hash !== "") throw new Error("Alchemy base URL must not contain credentials or query parameters.");
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && (allowInsecureHttp || isLoopbackHost(parsed.hostname)))) throw new Error("Alchemy base URL must use HTTPS unless insecure HTTP is explicitly enabled.");
  return value.replace(/\/$/, "");
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}
