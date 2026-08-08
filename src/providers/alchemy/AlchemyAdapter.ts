import { AxiosHttpTransport, parseHttpProxyUrl } from "../../transport/AxiosHttpTransport";
import type { HttpTransport } from "../../transport/HttpTransport";
import { EvmDataError } from "../../domain/errors";
import type { Erc20BalanceAtBlock, Erc20BalancesAtBlock, Erc20Transfer } from "../../domain/models";
import type { NormalizedErc20BlockRangeRequest, NormalizedErc20TransfersRequest, NormalizedTransactionsRequest, TransferDirection } from "../../domain/operations";
import type { ProviderPageResult } from "../../domain/pagination";
import type { CapabilityRequest, DataProviderAdapter, ProviderBlockRangeWindowResult, ProviderAttemptContext } from "../DataProviderAdapter";
import { classifyAlchemyHttpResponse, classifyAlchemyJsonRpcError, normalizeAlchemyTransportError } from "./alchemyErrors";
import { alchemyJsonRpcResponseSchema, alchemyTransfersResultSchema, type AlchemyTransfer } from "./alchemySchemas";
import { mapAlchemyTransfer } from "./alchemyMapper";
import { decodeAggregate3Result, encodeAggregate3, MULTICALL3_ADDRESS } from "../../rpc/EthereumMulticall3Codec";

export interface AlchemyAdapterOptions {
  readonly transport?: HttpTransport;
  readonly baseUrl?: string;
  readonly allowInsecureHttp?: boolean;
}

export const ALCHEMY_MAX_PAGE_SIZE = 1_000;
/** Keep one RPC request comfortably below provider request-size limits. */
// 50 calls keeps historical archive reads below conservative provider payload
// and compute limits while avoiding a request per token.
export const ALCHEMY_MULTICALL_MAX_BATCH_SIZE = 50;

const MULTICALL3_BY_CHAIN_ID: Readonly<Record<number, string>> = {
  1: MULTICALL3_ADDRESS,
  8453: MULTICALL3_ADDRESS,
};
const ERC20_BALANCE_OF_SELECTOR = "70a08231";

type AlchemyStreamDirection = Exclude<TransferDirection, "both">;

interface AlchemySinglePageState {
  readonly pageKey: string;
}

interface AlchemyBothPageState {
  readonly mode: "both";
  readonly incomingPageKey: string | null;
  readonly incomingExhausted: boolean;
  readonly outgoingPageKey: string | null;
  readonly outgoingExhausted: boolean;
}

interface AlchemyTransferPage {
  readonly transfers: readonly AlchemyMappedTransfer[];
  readonly nextPageKey: string | null;
}

interface AlchemyMappedTransfer {
  readonly uniqueId: string;
  readonly item: Erc20Transfer;
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
    // Native balances are not an indexed Alchemy API operation in this SDK.
    // Route native-balance reads to indexed explorer APIs instead.
    if (request.operation === "getNativeBalance") return false;
    if (request.operation === "getErc20Transfers") {
      return "pageSize" in request.request && request.request.pageSize <= ALCHEMY_MAX_PAGE_SIZE;
    }
    if (request.operation === "getErc20TransfersByBlockRange") return true;
    return false;
  }

  async getErc20Transfers(request: NormalizedErc20TransfersRequest, context: ProviderAttemptContext): Promise<ProviderPageResult<Erc20Transfer, AlchemySinglePageState | AlchemyBothPageState>> {
    if (request.direction === "both") {
      return this.getBothDirectionTransfers(request, context);
    }
    const pageState = readSinglePageState(context.providerPageState);
    const page = await this.getTransferPage(request, context, request.direction, pageState?.pageKey ?? null);
    if (page.nextPageKey !== null && page.nextPageKey === pageState?.pageKey) {
      throw invalidResponse(context, new Error("Alchemy returned the same pagination page key twice."));
    }
    return {
      items: page.transfers.map((transfer) => transfer.item),
      nextPageState: page.nextPageKey === null ? null : { pageKey: page.nextPageKey },
      pageInfo: { provider: this.name, chainId: context.chain.chainId },
    };
  }

  async getErc20TransfersByBlockRangeWindow(
    request: NormalizedErc20BlockRangeRequest,
    context: ProviderAttemptContext,
  ): Promise<ProviderBlockRangeWindowResult> {
    if (request.direction !== "both") {
      const page = await this.getRangeTransferPage(request, context, request.direction, false);
      return {
        items: page.transfers.map((transfer) => ({ item: transfer.item, identityKey: transfer.uniqueId })),
        complete: page.nextPageKey === null,
        pageInfo: { provider: this.name, chainId: context.chain.chainId },
      };
    }

    const [incoming, outgoing] = await Promise.all([
      this.getRangeTransferPage(request, context, "incoming", true),
      this.getRangeTransferPage(request, context, "outgoing", false),
    ]);
    const transfers = mergeBothDirectionPages(incoming, outgoing, "asc");
    return {
      items: transfers.map((transfer) => ({ item: transfer.item, identityKey: transfer.uniqueId })),
      complete: incoming.nextPageKey === null && outgoing.nextPageKey === null,
      pageInfo: { provider: this.name, chainId: context.chain.chainId },
    };
  }

  /**
   * Exact balances of a caller-supplied ERC-20 set at one historical block.
   * Each request is one standard JSON-RPC `eth_call` to Multicall3, not one
   * request per token. `allowFailure` prevents an unusual contract from
   * poisoning unrelated calls, but a failed/invalid result is still surfaced
   * rather than fabricated as a zero balance.
   */
  async getErc20BalancesAtBlock(
    request: { readonly address: string; readonly blockNumber: string; readonly tokenAddresses: readonly string[] },
    context: ProviderAttemptContext,
  ): Promise<Erc20BalancesAtBlock> {
    const multicall3 = MULTICALL3_BY_CHAIN_ID[context.chain.chainId];
    if (multicall3 === undefined) {
      throw new EvmDataError({
        code: "UNSUPPORTED_OPERATION",
        message: "Alchemy historical ERC-20 balance batching is unsupported for this chain.",
        retryable: false,
        provider: this.name,
        chainId: context.chain.chainId,
      });
    }
    const tokenAddresses = uniqueAddresses(request.tokenAddresses, context);
    const items: Erc20BalanceAtBlock[] = [];
    for (const tokens of chunk(tokenAddresses, ALCHEMY_MULTICALL_MAX_BATCH_SIZE)) {
      const callData = `0x${ERC20_BALANCE_OF_SELECTOR}${wordAddress(request.address)}`;
      const encoded = encodeAggregate3(
        tokens.map((token) => ({ target: token, allowFailure: true, callData })),
      );
      const body = await this.call(
        "eth_call",
        [{ to: multicall3, data: encoded }, decimalToHex(request.blockNumber)],
        context,
      );
      const result = parseResult(body, context);
      const balances = decodeAggregate3Balances(result, tokens, context);
      for (let index = 0; index < tokens.length; index += 1) {
        items.push({
          chainId: context.chain.chainId,
          address: request.address,
          tokenAddress: tokens[index]!,
          blockNumber: BigInt(request.blockNumber).toString(),
          amount: balances[index]!.toString(),
          provider: this.name,
        });
      }
    }
    return {
      chainId: context.chain.chainId,
      address: request.address,
      blockNumber: BigInt(request.blockNumber).toString(),
      items,
      provider: this.name,
    };
  }

  private async getBothDirectionTransfers(
    request: NormalizedErc20TransfersRequest,
    context: ProviderAttemptContext,
  ): Promise<ProviderPageResult<Erc20Transfer, AlchemyBothPageState>> {
    const pageState = readBothPageState(context.providerPageState);
    const [incoming, outgoing] = await Promise.all([
      pageState.incomingExhausted
        ? null
        : this.getTransferPage(request, context, "incoming", pageState.incomingPageKey, true),
      pageState.outgoingExhausted
        ? null
        : this.getTransferPage(request, context, "outgoing", pageState.outgoingPageKey),
    ]);
    const nextPageState = (incoming === null || incoming.nextPageKey === null) &&
      (outgoing === null || outgoing.nextPageKey === null)
      ? null
      : {
        mode: "both" as const,
        incomingPageKey: incoming?.nextPageKey ?? null,
        incomingExhausted: incoming === null || incoming.nextPageKey === null,
        outgoingPageKey: outgoing?.nextPageKey ?? null,
        outgoingExhausted: outgoing === null || outgoing.nextPageKey === null,
      };
    return {
      items: mergeBothDirectionPages(incoming, outgoing, request.order).map((transfer) => transfer.item),
      nextPageState,
      pageInfo: { provider: this.name, chainId: context.chain.chainId },
    };
  }

  private async getTransferPage(
    request: NormalizedErc20TransfersRequest,
    context: ProviderAttemptContext,
    direction: AlchemyStreamDirection,
    pageKey: string | null,
    excludeSelfTransfers = false,
  ): Promise<AlchemyTransferPage> {
    const filter: Record<string, unknown> = {
      category: ["erc20"],
      withMetadata: true,
      excludeZeroValue: false,
      order: request.order,
      maxCount: `0x${request.pageSize.toString(16)}`,
      ...(direction === "incoming" ? { toAddress: request.address } : { fromAddress: request.address }),
      ...(request.tokenAddress === null ? {} : { contractAddresses: [request.tokenAddress] }),
      ...(request.startBlock === null ? { fromBlock: "0x0" } : { fromBlock: decimalToHex(request.startBlock) }),
      ...(request.endBlock === null ? { toBlock: "latest" } : { toBlock: decimalToHex(request.endBlock) }),
      ...(pageKey === null ? {} : { pageKey }),
    };
    const body = await this.call("alchemy_getAssetTransfers", [filter], context);
    const result = alchemyTransfersResultSchema.safeParse(parseResult(body, context));
    if (!result.success) throw invalidResponse(context);
    try {
      const nextPageKey = normalizeNextPageKey(result.data.pageKey);
      if (nextPageKey !== null && nextPageKey === pageKey) {
        throw new Error("Alchemy returned the same pagination page key twice.");
      }
      return {
        transfers: result.data.transfers
          .map((transfer) => mapTransferWithId(transfer, context))
          // A self-transfer matches both upstream filters. In composite mode it
          // belongs to outgoing only, keeping the two paginated streams disjoint.
          .filter((transfer) => !excludeSelfTransfers || transfer.item.from !== request.address),
        nextPageKey,
      };
    } catch (error: unknown) {
      throw invalidResponse(context, error);
    }
  }

  private async getRangeTransferPage(
    request: NormalizedErc20BlockRangeRequest,
    context: ProviderAttemptContext,
    direction: AlchemyStreamDirection,
    excludeSelfTransfers: boolean,
  ): Promise<AlchemyTransferPage> {
    const filter: Record<string, unknown> = {
      category: ["erc20"],
      withMetadata: true,
      excludeZeroValue: false,
      order: "asc",
      maxCount: "0x3e8",
      ...(direction === "incoming" ? { toAddress: request.address } : { fromAddress: request.address }),
      ...(request.tokenAddress === null ? {} : { contractAddresses: [request.tokenAddress] }),
      fromBlock: decimalToHex(request.startBlock),
      toBlock: decimalToHex(request.endBlock),
    };
    const body = await this.call("alchemy_getAssetTransfers", [filter], context);
    const result = alchemyTransfersResultSchema.safeParse(parseResult(body, context));
    if (!result.success) throw invalidResponse(context);
    try {
      return {
        transfers: result.data.transfers
          .map((transfer) => mapTransferWithId(transfer, context))
          .filter((transfer) => !excludeSelfTransfers || transfer.item.from !== request.address),
        nextPageKey: normalizeNextPageKey(result.data.pageKey),
      };
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
      response = await this.transport.request({ method: "POST", url: alchemyEndpoint(this.baseUrlOverride ?? route.httpUrlPrefix, context.credential.value), headers: { "content-type": "application/json" }, body: { jsonrpc: "2.0", id: 1, method, params }, timeoutMs: context.timeoutMs, ...(context.signal === undefined ? {} : { signal: context.signal }), proxy: context.proxy === null ? null : parseHttpProxyUrl(context.proxy.url) });
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

function mapTransferWithId(value: AlchemyTransfer, context: ProviderAttemptContext): AlchemyMappedTransfer {
  return { uniqueId: value.uniqueId, item: mapAlchemyTransfer(value, context.chain) };
}

function mergeBothDirectionPages(
  incoming: AlchemyTransferPage | null,
  outgoing: AlchemyTransferPage | null,
  order: "asc" | "desc",
): readonly AlchemyMappedTransfer[] {
  const uniqueTransfers = new Map<string, AlchemyMappedTransfer>();
  for (const transfer of [...(incoming?.transfers ?? []), ...(outgoing?.transfers ?? [])]) {
    uniqueTransfers.set(transfer.uniqueId, transfer);
  }
  return [...uniqueTransfers.values()].sort((first, second) => compareTransfers(first, second, order));
}

function compareTransfers(
  first: AlchemyMappedTransfer,
  second: AlchemyMappedTransfer,
  order: "asc" | "desc",
): number {
  const blockComparison = BigInt(first.item.blockNumber) < BigInt(second.item.blockNumber)
    ? -1
    : BigInt(first.item.blockNumber) > BigInt(second.item.blockNumber)
      ? 1
      : 0;
  const identityComparison = first.uniqueId < second.uniqueId ? -1 : first.uniqueId > second.uniqueId ? 1 : 0;
  const comparison = blockComparison === 0 ? identityComparison : blockComparison;
  return order === "asc" ? comparison : -comparison;
}

function readSinglePageState(value: unknown): AlchemySinglePageState | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value) || value === null) throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Alchemy page state is invalid.", retryable: false, provider: "alchemy" });
  const pageKey = (value as { pageKey?: unknown }).pageKey;
  if (Object.keys(value).length !== 1 || !isPageKey(pageKey) || pageKey === null) throw new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Alchemy page state is invalid.", retryable: false, provider: "alchemy" });
  return { pageKey };
}

function readBothPageState(value: unknown): AlchemyBothPageState {
  if (value === undefined || value === null) {
    return {
      mode: "both",
      incomingPageKey: null,
      incomingExhausted: false,
      outgoingPageKey: null,
      outgoingExhausted: false,
    };
  }
  if (typeof value !== "object" || Array.isArray(value) || value === null) throw invalidBothPageState();
  const state = value as Partial<AlchemyBothPageState>;
  if (
    Object.keys(value).length !== 5 ||
    state.mode !== "both" ||
    !isPageKey(state.incomingPageKey) ||
    !isPageKey(state.outgoingPageKey) ||
    typeof state.incomingExhausted !== "boolean" ||
    typeof state.outgoingExhausted !== "boolean" ||
    state.incomingExhausted && state.incomingPageKey !== null ||
    state.outgoingExhausted && state.outgoingPageKey !== null
  ) throw invalidBothPageState();
  return {
    mode: "both",
    incomingPageKey: state.incomingPageKey,
    incomingExhausted: state.incomingExhausted,
    outgoingPageKey: state.outgoingPageKey,
    outgoingExhausted: state.outgoingExhausted,
  };
}

function isPageKey(value: unknown): value is string | null {
  return value === null || typeof value === "string" && value.length > 0 && value.length <= 2048 && !/^https?:\/\//i.test(value);
}

function normalizeNextPageKey(value: string | null | undefined): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (!isPageKey(value)) throw new Error("Alchemy returned an invalid pagination page key.");
  return value;
}

function invalidBothPageState(): EvmDataError {
  return new EvmDataError({ code: "INVALID_PROVIDER_RESPONSE", message: "Alchemy both-direction page state is invalid.", retryable: false, provider: "alchemy" });
}

function decimalToHex(value: string): string {
  return `0x${BigInt(value).toString(16)}`;
}

function uniqueAddresses(values: readonly string[], context: ProviderAttemptContext): string[] {
  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const value of values) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
      throw new EvmDataError({ code: "INVALID_REQUEST", message: "Alchemy ERC-20 balance batching requires contract addresses.", retryable: false, provider: "alchemy", chainId: context.chain.chainId });
    }
    const normalized = value.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      addresses.push(normalized);
    }
  }
  return addresses;
}

function chunk<T>(values: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) batches.push(values.slice(index, index + size));
  return batches;
}

/**
 * Decodes each `aggregate3` tuple (via the shared pure Multicall3 codec) into
 * an ERC-20 balance. `allowFailure: true` still surfaces a per-token revert
 * as an explicit error rather than a fabricated balance; only a genuinely
 * empty return (undeployed contract at this historical block) is zero.
 */
function decodeAggregate3Balances(value: unknown, tokenAddresses: readonly string[], context: ProviderAttemptContext): bigint[] {
  if (typeof value !== "string") throw invalidResponse(context);
  let results;
  try {
    results = decodeAggregate3Result(value, tokenAddresses.length);
  } catch (error: unknown) {
    throw invalidResponse(context, error);
  }
  return results.map((result, index) => {
    if (!result.success) {
      throw new EvmDataError({
        code: "INVALID_PROVIDER_RESPONSE",
        message: `Alchemy Multicall balanceOf reverted for ${tokenAddresses[index]}.`,
        retryable: false,
        provider: "alchemy",
        chainId: context.chain.chainId,
      });
    }
    // An eth_call to an address without code succeeds and returns 0x. At the
    // requested historical block that means this contract was not deployed,
    // so its ERC-20 balance is deterministically zero.
    if (result.returnData === "0x") return 0n;
    if (!/^0x[0-9a-fA-F]{64}$/.test(result.returnData)) throw invalidResponse(context);
    return BigInt(result.returnData);
  });
}

function wordAddress(value: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error("Invalid ABI address.");
  return value.slice(2).toLowerCase().padStart(64, "0");
}

/** Alchemy JSON-RPC authenticates with the key in the `/v2/<key>` path. */
function alchemyEndpoint(prefix: string, apiKey: string): string {
  if (!apiKey.trim()) throw new Error("Alchemy API key is empty.");
  return `${prefix.replace(/\/$/, "")}/${encodeURIComponent(apiKey)}`;
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
