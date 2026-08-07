import type { BeaconWithdrawalBlockRange, InternalNativeTransferBlockRange, NativeBalance, Page, Transaction, TransactionBlockRange, TransactionContextsByHashResult } from "../domain/models";
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
  constructor(
    private readonly executor: RequestExecutor,
    private readonly indexedApi: ApiChainService,
  ) {}

  getTransactions(request: TransactionsRequest): Promise<Page<Transaction>> {
    return this.executor.execute(normalizeTransactionsRequest(request));
  }

  /** Complete one closed range while keeping the provider cursor SDK-owned. */
  async getTransactionsByBlockRange(request: TransactionsBlockRangeRequest): Promise<TransactionBlockRange> {
    const first = normalizeTransactionsRequest({
      ...request,
      pageSize: 10_000,
      fullData: true,
      order: request.order ?? 'asc',
    });
    let page = await this.executor.execute(first);
    const items: Transaction[] = [...page.items];
    let pages = 1;
    while (page.nextCursor !== null) {
      if (pages >= 1_000 || items.length > 100_000) {
        throw new Error('Transaction block-range scan exceeded its bounded limit.');
      }
      page = await this.executor.execute({ ...first, cursor: page.nextCursor });
      items.push(...page.items);
      pages += 1;
    }
    return {
      chainId: page.pageInfo.chainId,
      address: first.address,
      range: { startBlock: first.startBlock ?? '0', endBlock: first.endBlock ?? '0' },
      items,
      provider: page.pageInfo.provider,
      pages,
      upstreamRequests: pages,
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
