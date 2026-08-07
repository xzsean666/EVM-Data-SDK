import type { BeaconWithdrawalBlockRange, InternalNativeTransferBlockRange, NativeBalance, Page, Transaction, TransactionBlockRange, TransactionBlockRangeWindow, TransactionContextsByHashResult } from "../domain/models";
import { EvmDataError } from "../domain/errors";
import {
  normalizeNativeBalanceRequest,
  normalizeTransactionContextsByHashRequest,
  normalizeTransactionsRequest,
  type NativeBalanceRequest,
  type TransactionContextsByHashRequest,
  type TransactionsBlockRangeRequest,
  type TransactionsRequest,
} from "../domain/operations";
import type { RequestExecutor } from "../execution/RequestExecutor";
import type { ApiChainService } from './ApiChainService';

export class AddressService {
  private readonly maxRangeRecords: number;
  private readonly maxRangeWindows: number;

  constructor(
    private readonly executor: RequestExecutor,
    private readonly indexedApi: ApiChainService,
    options: { readonly maxRangeRecords: number; readonly maxRangeWindows: number },
  ) {
    this.maxRangeRecords = options.maxRangeRecords;
    this.maxRangeWindows = options.maxRangeWindows;
  }

  getTransactions(request: TransactionsRequest): Promise<Page<Transaction>> {
    return this.executor.execute(normalizeTransactionsRequest(request));
  }

  /** Complete one closed range while keeping the provider cursor SDK-owned. */
  async getTransactionsByBlockRange(request: TransactionsBlockRangeRequest): Promise<TransactionBlockRange> {
    const { onWindow, ...rangeRequest } = request;
    const first = normalizeTransactionsRequest({
      ...rangeRequest,
      pageSize: 10_000,
      fullData: true,
      order: rangeRequest.order ?? 'asc',
    });
    const pending = [{ startBlock: first.startBlock!, endBlock: first.endBlock! }];
    const completed: { startBlock: string; endBlock: string }[] = [];
    const records = new Map<string, Transaction>();
    let provider: Transaction['provider'] | null = null;
    let chainId: number | null = null;
    let upstreamRequests = 0;

    while (pending.length > 0) {
      if (first.signal?.aborted === true) {
        throw new EvmDataError({ code: 'REQUEST_ABORTED', message: 'Request was aborted by the caller.', retryable: false });
      }
      if (completed.length + pending.length > this.maxRangeWindows) {
        throw transactionRangeStalled(completed.length, 'The configured transaction block-range window limit was exceeded.');
      }
      const window = pending.shift();
      if (window === undefined) break;
      const page = await this.executor.execute({
        ...first,
        startBlock: window.startBlock,
        endBlock: window.endBlock,
        cursor: null,
      });
      upstreamRequests += 1;
      if (page.nextCursor !== null) {
        if (window.startBlock === window.endBlock) {
          throw transactionRangeStalled(completed.length, 'No configured provider could prove the single block window is complete.');
        }
        const [left, right] = splitTransactionWindow(window);
        pending.unshift(left, right);
        continue;
      }
      if (provider === null) {
        provider = page.pageInfo.provider;
        chainId = page.pageInfo.chainId;
      } else if (provider !== page.pageInfo.provider || chainId !== page.pageInfo.chainId) {
        throw transactionRangeStalled(completed.length, 'The provider changed after the block-range scan had started.');
      }
      const windowRecords = new Map<string, Transaction>();
      for (const item of page.items) {
        const blockNumber = BigInt(item.blockNumber);
        if (blockNumber < BigInt(window.startBlock) || blockNumber > BigInt(window.endBlock)) {
          throw transactionRangeStalled(completed.length, 'Provider returned a transaction outside the requested block window.');
        }
        if (item.chainId !== chainId || item.provider !== provider) {
          throw transactionRangeStalled(completed.length, 'Provider returned a transaction outside the pinned scan provenance.');
        }
        const seen = onWindow === undefined ? records : windowRecords;
        if (!seen.has(item.hash)) {
          if (seen.size >= this.maxRangeRecords) {
            throw new EvmDataError({ code: 'RANGE_RESULT_TOO_LARGE', message: 'The transaction block-range result exceeds the configured record safety limit.', retryable: false, provider, chainId });
          }
          seen.set(item.hash, item);
        }
      }
      if (onWindow !== undefined) {
        const items = [...windowRecords.values()].sort(compareTransactions);
        const callback: TransactionBlockRangeWindow = Object.freeze({
          chainId: chainId!,
          address: first.address,
          range: Object.freeze({ startBlock: window.startBlock, endBlock: window.endBlock }),
          items: Object.freeze(items),
          provider: provider!,
          upstreamRequests: 1,
        });
        await onWindow(callback);
      }
      completed.push(window);
    }
    if (chainId === null || provider === null || !transactionCoverageIsExact(completed, first.startBlock!, first.endBlock!)) {
      throw transactionRangeStalled(completed.length, 'The transaction block-range scan did not complete its requested coverage.');
    }
    return {
      chainId,
      address: first.address,
      range: { startBlock: first.startBlock ?? '0', endBlock: first.endBlock ?? '0' },
      items: onWindow === undefined ? [...records.values()].sort(compareTransactions) : [],
      provider,
      pages: completed.length,
      upstreamRequests,
    };
  }

  getNativeBalance(request: NativeBalanceRequest): Promise<NativeBalance> {
    return this.executor.execute(normalizeNativeBalanceRequest(request));
  }

  /** API-only indexed transaction/receipt/full-log contexts for action parsing. */
  getTransactionContextsByHash(
    request: TransactionContextsByHashRequest,
  ): Promise<TransactionContextsByHashResult> {
    const normalized = normalizeTransactionContextsByHashRequest(request);
    return this.indexedApi.getTransactionContextsByHash(normalized);
  }

  /** API-only explorer lookup for address-scoped internal native transfers. */
  async getInternalNativeTransfersByBlockRange(
    request: TransactionsBlockRangeRequest,
  ): Promise<InternalNativeTransferBlockRange> {
    const normalized = normalizeTransactionsRequest({
      ...request,
      pageSize: 1,
      fullData: true,
      order: request.order ?? 'asc',
    });
    return this.indexedApi.getInternalNativeTransfersByBlockRange({
      chain: normalized.chain,
      address: normalized.address,
      startBlock: normalized.startBlock ?? '0',
      endBlock: normalized.endBlock ?? '0',
      ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
    });
  }

  /** API-only EIP-4895 withdrawal lookup; only Ethereum is supported. */
  async getBeaconWithdrawalsByBlockRange(
    request: TransactionsBlockRangeRequest,
  ): Promise<BeaconWithdrawalBlockRange> {
    const normalized = normalizeTransactionsRequest({
      ...request,
      pageSize: 1,
      fullData: true,
      order: request.order ?? 'asc',
    });
    return this.indexedApi.getBeaconWithdrawalsByBlockRange({
      chain: normalized.chain,
      address: normalized.address,
      startBlock: normalized.startBlock ?? '0',
      endBlock: normalized.endBlock ?? '0',
      ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
    });
  }
}

function splitTransactionWindow(window: { startBlock: string; endBlock: string }) {
  const start = BigInt(window.startBlock);
  const end = BigInt(window.endBlock);
  const midpoint = (start + end) / 2n;
  return [
    { startBlock: start.toString(), endBlock: midpoint.toString() },
    { startBlock: (midpoint + 1n).toString(), endBlock: end.toString() },
  ] as const;
}

function compareTransactions(first: Transaction, second: Transaction) {
  const firstBlock = BigInt(first.blockNumber);
  const secondBlock = BigInt(second.blockNumber);
  if (firstBlock !== secondBlock) return firstBlock < secondBlock ? -1 : 1;
  if (first.transactionIndex === null) return second.transactionIndex === null ? first.hash.localeCompare(second.hash) : 1;
  if (second.transactionIndex === null) return -1;
  const firstIndex = BigInt(first.transactionIndex);
  const secondIndex = BigInt(second.transactionIndex);
  return firstIndex === secondIndex ? first.hash.localeCompare(second.hash) : firstIndex < secondIndex ? -1 : 1;
}

function transactionCoverageIsExact(completed: readonly { startBlock: string; endBlock: string }[], startBlock: string, endBlock: string) {
  const ordered = [...completed].sort((first, second) => BigInt(first.startBlock) < BigInt(second.startBlock) ? -1 : BigInt(first.startBlock) > BigInt(second.startBlock) ? 1 : 0);
  let next = BigInt(startBlock);
  for (const window of ordered) {
    if (BigInt(window.startBlock) !== next || BigInt(window.endBlock) < next) return false;
    next = BigInt(window.endBlock) + 1n;
  }
  return next === BigInt(endBlock) + 1n;
}

function transactionRangeStalled(completedWindows: number, message: string) {
  return new EvmDataError({
    code: 'BLOCK_RANGE_STALLED',
    message: `${message} Completed windows: ${completedWindows}.`,
    retryable: false,
  });
}
