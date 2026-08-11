import type { BeaconWithdrawalBlockRange, InternalNativeTransferBlockRange, NativeBalance, Page, Transaction, TransactionBlockRange, TransactionBlockRangeWindow, TransactionContextsByHashResult } from "../domain/models";
import { EvmDataError } from "../domain/errors";
import {
  normalizeNativeBalanceRequest,
  normalizeTransactionContextsByHashRequest,
  normalizeTransactionsRequest,
  type NativeBalanceRequest,
  type TransactionContextsByHashRequest,
  type BeaconWithdrawalsBlockRangeRequest,
  type InternalNativeTransfersBlockRangeRequest,
  type TransactionsBlockRangeRequest,
  type TransactionsRequest,
} from "../domain/operations";
import type { RequestExecutor } from "../execution/RequestExecutor";
import type { ApiChainService } from './ApiChainService';

export class AddressService {
  private readonly maxRangeRecords: number;

  constructor(
    private readonly executor: RequestExecutor,
    private readonly indexedApi: ApiChainService,
    options: { readonly maxRangeRecords: number; readonly maxRangeWindows: number },
  ) {
    this.maxRangeRecords = options.maxRangeRecords;
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
    const records = new Map<string, Transaction>();
    let provider: Transaction['provider'] | null = null;
    let chainId: number | null = null;
    let upstreamRequests = 0;
    const startBlock = first.startBlock!;
    const endBlock = first.endBlock!;
    let cursor: string | null = null;

    while (true) {
      if (first.signal?.aborted === true) {
        throw new EvmDataError({ code: 'REQUEST_ABORTED', message: 'Request was aborted by the caller.', retryable: false });
      }
      const page: Page<Transaction> = await this.executor.execute({
        ...first,
        startBlock,
        endBlock,
        cursor,
      });
      upstreamRequests += 1;
      if (provider === null) {
        provider = page.pageInfo.provider;
        chainId = page.pageInfo.chainId;
      } else if (provider !== page.pageInfo.provider || chainId !== page.pageInfo.chainId) {
        throw transactionRangeStalled(upstreamRequests - 1, 'The provider changed during the complete block-range scan.');
      }
      for (const item of page.items) {
        const blockNumber = BigInt(item.blockNumber);
        if (blockNumber < BigInt(startBlock) || blockNumber > BigInt(endBlock)) {
          throw transactionRangeStalled(upstreamRequests - 1, 'Provider returned a transaction outside the requested block window.');
        }
        if (item.chainId !== chainId || item.provider !== provider) {
          throw transactionRangeStalled(upstreamRequests - 1, 'Provider returned a transaction outside the pinned scan provenance.');
        }
        if (!records.has(item.hash)) {
          if (records.size >= this.maxRangeRecords) {
            throw new EvmDataError({ code: 'RANGE_RESULT_TOO_LARGE', message: 'The transaction block-range result exceeds the configured record safety limit.', retryable: false, provider, chainId });
          }
          records.set(item.hash, item);
        }
      }
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
    }
    if (chainId === null || provider === null) {
      throw transactionRangeStalled(upstreamRequests, 'The transaction block-range scan returned no provider result.');
    }
    if (onWindow !== undefined) {
      const items = [...records.values()].sort(compareTransactions);
      await onWindow(Object.freeze({
        chainId,
        address: first.address,
        range: Object.freeze({ startBlock, endBlock }),
        items: Object.freeze(items),
        provider,
        upstreamRequests,
      }));
    }
    return {
      chainId,
      address: first.address,
      range: { startBlock, endBlock },
      items: onWindow === undefined ? [...records.values()].sort(compareTransactions) : [],
      provider,
      pages: upstreamRequests,
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
    request: InternalNativeTransfersBlockRangeRequest,
  ): Promise<InternalNativeTransferBlockRange> {
    const { onWindow, ...rangeRequest } = request;
    const normalized = normalizeTransactionsRequest({
      ...rangeRequest,
      pageSize: 1,
      fullData: true,
      order: request.order ?? 'asc',
    });
    const startBlock = normalized.startBlock ?? '0';
    const endBlock = normalized.endBlock ?? '0';
    const ranges = [{ startBlock, endBlock }];
    let chainId: number | null = null;
    let provider: InternalNativeTransferBlockRange['provider'] | null = null;
    let pages = 0;
    let upstreamRequests = 0;
    const items: InternalNativeTransferBlockRange['items'][number][] = [];
    for (const range of ranges) {
      const result = await this.indexedApi.getInternalNativeTransfersByBlockRange({
        chain: normalized.chain,
        address: normalized.address,
        startBlock: range.startBlock,
        endBlock: range.endBlock,
        ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
      });
      assertIndexedRange(result.range, range);
      if (chainId === null) chainId = result.chainId;
      if (provider === null) provider = result.provider;
      if (chainId !== result.chainId) {
        throw new EvmDataError({
          code: 'BLOCK_RANGE_STALLED',
          message: 'The indexed chain changed during the internal-native block-range scan.',
          retryable: false,
          provider: result.provider,
          chainId: result.chainId,
        });
      }
      pages += result.pages;
      upstreamRequests += result.upstreamRequests;
      if (onWindow !== undefined) {
        await onWindow(Object.freeze({
          chainId: result.chainId,
          address: result.address,
          range: Object.freeze(result.range),
          items: Object.freeze(result.items),
          provider: result.provider,
          upstreamRequests: result.upstreamRequests,
        }));
      } else {
        items.push(...result.items);
      }
    }
    return {
      chainId: chainId!,
      address: normalized.address,
      range: { startBlock, endBlock },
      items: onWindow === undefined ? items : [],
      provider: provider!,
      pages,
      upstreamRequests,
    };
  }

  /** API-only EIP-4895 withdrawal lookup; only Ethereum is supported. */
  async getBeaconWithdrawalsByBlockRange(
    request: BeaconWithdrawalsBlockRangeRequest,
  ): Promise<BeaconWithdrawalBlockRange> {
    const { onWindow, ...rangeRequest } = request;
    const normalized = normalizeTransactionsRequest({
      ...rangeRequest,
      pageSize: 1,
      fullData: true,
      order: request.order ?? 'asc',
    });
    const startBlock = normalized.startBlock ?? '0';
    const endBlock = normalized.endBlock ?? '0';
    const ranges = [{ startBlock, endBlock }];
    let chainId: number | null = null;
    let provider: BeaconWithdrawalBlockRange['provider'] | null = null;
    let pages = 0;
    let upstreamRequests = 0;
    const items: BeaconWithdrawalBlockRange['items'][number][] = [];
    for (const range of ranges) {
      const result = await this.indexedApi.getBeaconWithdrawalsByBlockRange({
        chain: normalized.chain,
        address: normalized.address,
        startBlock: range.startBlock,
        endBlock: range.endBlock,
        ...(normalized.signal === undefined ? {} : { signal: normalized.signal }),
      });
      assertIndexedRange(result.range, range);
      if (chainId === null) chainId = result.chainId;
      if (provider === null) provider = result.provider;
      if (chainId !== result.chainId) {
        throw new EvmDataError({
          code: 'BLOCK_RANGE_STALLED',
          message: 'The indexed chain changed during the Beacon withdrawal block-range scan.',
          retryable: false,
          provider: result.provider,
          chainId: result.chainId,
        });
      }
      pages += result.pages;
      upstreamRequests += result.upstreamRequests;
      if (onWindow !== undefined) {
        await onWindow(Object.freeze({
          chainId: result.chainId,
          address: result.address,
          range: Object.freeze(result.range),
          items: Object.freeze(result.items),
          provider: result.provider,
          upstreamRequests: result.upstreamRequests,
        }));
      } else {
        items.push(...result.items);
      }
    }
    return {
      chainId: chainId!,
      address: normalized.address,
      range: { startBlock, endBlock },
      items: onWindow === undefined ? items : [],
      provider: provider!,
      pages,
      upstreamRequests,
    };
  }
}

function assertIndexedRange(actual: { startBlock: string; endBlock: string }, expected: { startBlock: string; endBlock: string }) {
  if (actual.startBlock !== expected.startBlock || actual.endBlock !== expected.endBlock) {
    throw new EvmDataError({
      code: 'BLOCK_RANGE_INCOMPLETE',
      message: `The indexed provider returned ${actual.startBlock}-${actual.endBlock}; expected ${expected.startBlock}-${expected.endBlock}.`,
      retryable: false,
    });
  }
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

function transactionRangeStalled(completedWindows: number, message: string) {
  return new EvmDataError({
    code: 'BLOCK_RANGE_STALLED',
    message: `${message} Completed windows: ${completedWindows}.`,
    retryable: false,
  });
}
