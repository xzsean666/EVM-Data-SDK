import type { NativeBalance, Page, Transaction } from "../domain/models";
import {
  normalizeNativeBalanceRequest,
  normalizeTransactionsRequest,
  type NativeBalanceRequest,
  type TransactionsRequest,
} from "../domain/operations";
import type { RequestExecutor } from "../execution/RequestExecutor";

export class AddressService {
  constructor(private readonly executor: RequestExecutor) {}

  getTransactions(request: TransactionsRequest): Promise<Page<Transaction>> {
    return this.executor.execute(normalizeTransactionsRequest(request));
  }

  getNativeBalance(request: NativeBalanceRequest): Promise<NativeBalance> {
    return this.executor.execute(normalizeNativeBalanceRequest(request));
  }
}
