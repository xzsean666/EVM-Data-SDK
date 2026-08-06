import type { Erc20BlockRangeResult, Erc20Transfer } from "../domain/models";
import { EvmDataError, isEvmDataError } from "../domain/errors";
import type { NormalizedErc20BlockRangeRequest } from "../domain/operations";
import type { ProviderBlockRangeItem } from "../providers/DataProviderAdapter";
import type { BlockRangeProviderPin, RequestExecutor } from "./RequestExecutor";

export interface BlockRangeScannerOptions {
  readonly executor: RequestExecutor;
  readonly maxRangeRecords: number;
  readonly maxRangeWindows: number;
}

interface ClosedWindow {
  readonly startBlock: string;
  readonly endBlock: string;
}

interface CollectedItem {
  readonly item: Erc20Transfer;
  readonly identity: string;
}

/** Covers an inclusive interval using complete, disjoint fresh range windows. */
export class BlockRangeScanner {
  private readonly executor: RequestExecutor;
  private readonly maxRangeRecords: number;
  private readonly maxRangeWindows: number;

  constructor(options: BlockRangeScannerOptions) {
    this.executor = options.executor;
    this.maxRangeRecords = options.maxRangeRecords;
    this.maxRangeWindows = options.maxRangeWindows;
  }

  async scan(request: NormalizedErc20BlockRangeRequest): Promise<Erc20BlockRangeResult> {
    const pending: ClosedWindow[] = [{ startBlock: request.startBlock, endBlock: request.endBlock }];
    const completed: ClosedWindow[] = [];
    const providers: Erc20Transfer["provider"][] = [];
    const providerWindows: Record<string, number> = {};
    const records = new Map<string, CollectedItem>();
    let chainId: number | null = null;
    let upstreamRequests = 0;
    let duplicateItemsRemoved = 0;
    let providerPin: BlockRangeProviderPin | undefined;

    while (pending.length > 0) {
      if (request.signal?.aborted === true) {
        throw new EvmDataError({ code: "REQUEST_ABORTED", message: "Request was aborted by the caller.", retryable: false });
      }
      if (completed.length + pending.length > this.maxRangeWindows) {
        throw stalled(completed.length, "The configured block-range window limit was exceeded.");
      }
      const window = pending.shift();
      if (window === undefined) break;
      const windowRequest: NormalizedErc20BlockRangeRequest = { ...request, startBlock: window.startBlock, endBlock: window.endBlock };

      let execution;
      try {
        execution = await this.executor.execute(windowRequest, providerPin);
      } catch (error: unknown) {
        if (isEvmDataError(error) && (error.code === "REQUEST_ABORTED" || error.code === "BLOCK_RANGE_STALLED")) {
          throw error;
        }
        throw incomplete(window, completed.length, error);
      }
      upstreamRequests += execution.upstreamRequests;
      if (providerPin === undefined) {
        providerPin = execution.providerPin;
      } else if (
        execution.providerPin.configurationId !== providerPin.configurationId ||
        execution.providerPin.provider !== providerPin.provider ||
        execution.providerPin.chainId !== providerPin.chainId
      ) {
        throw stalled(completed.length, "The provider changed after the block-range scan had started.");
      }

      if (!execution.result.complete) {
        if (window.startBlock === window.endBlock) {
          throw stalled(completed.length, "No configured provider could prove the single block window is complete.");
        }
        const split = splitWindow(window);
        // Keep deterministic ascending coverage order while preserving the
        // exact, non-overlapping closed partition returned by splitWindow.
        pending.unshift(split[0], split[1]);
        continue;
      }

      const provider = execution.result.pageInfo.provider;
      if (provider !== providerPin.provider || execution.result.pageInfo.chainId !== providerPin.chainId) {
        throw stalled(completed.length, "The provider returned a result outside the pinned scan provenance.");
      }
      chainId = execution.result.pageInfo.chainId;
      if (!providers.includes(provider)) providers.push(provider);
      providerWindows[provider] = (providerWindows[provider] ?? 0) + 1;
      for (const resultItem of execution.result.items) {
        if (
          resultItem.item.chainId !== execution.result.pageInfo.chainId ||
          resultItem.item.provider !== provider ||
          !isInWindow(resultItem.item, window)
        ) {
          throw stalled(completed.length, "Provider returned a transfer with an invalid range, chain, or provenance boundary.");
        }
        const identity = stableIdentity(resultItem);
        if (identity === null) {
          throw stalled(completed.length, "Provider omitted both log index and a documented stable transfer identity.");
        }
        if (records.has(identity)) {
          duplicateItemsRemoved += 1;
          continue;
        }
        if (records.size >= this.maxRangeRecords) {
          throw new EvmDataError({
            code: "RANGE_RESULT_TOO_LARGE",
            message: "The block-range result exceeds the configured record safety limit.",
            retryable: false,
            provider,
            chainId: resultItem.item.chainId,
          });
        }
        records.set(identity, { item: resultItem.item, identity });
      }
      completed.push(window);
    }

    if (chainId === null || !coversExactly(completed, request.startBlock, request.endBlock)) {
      throw incomplete({ startBlock: request.startBlock, endBlock: request.endBlock }, completed.length, undefined);
    }

    const items = [...records.values()].sort(compareCollectedItems).map((entry) => Object.freeze({ ...entry.item }));
    return Object.freeze({
      chainId,
      address: request.address,
      range: Object.freeze({ startBlock: request.startBlock, endBlock: request.endBlock }),
      direction: request.direction,
      items: Object.freeze(items),
      providers: Object.freeze([...providers]),
      stats: Object.freeze({
        windows: completed.length,
        upstreamRequests,
        duplicateItemsRemoved,
        providerWindows: Object.freeze({ ...providerWindows }),
      }),
    });
  }
}

function splitWindow(window: ClosedWindow): readonly [ClosedWindow, ClosedWindow] {
  const start = BigInt(window.startBlock);
  const end = BigInt(window.endBlock);
  const midpoint = (start + end) / 2n;
  return [
    { startBlock: start.toString(), endBlock: midpoint.toString() },
    { startBlock: (midpoint + 1n).toString(), endBlock: end.toString() },
  ];
}

function isInWindow(item: Erc20Transfer, window: ClosedWindow): boolean {
  const block = BigInt(item.blockNumber);
  return block >= BigInt(window.startBlock) && block <= BigInt(window.endBlock);
}

function stableIdentity(value: ProviderBlockRangeItem): string | null {
  const item = value.item;
  if (item.logIndex !== null) return String(item.chainId) + ":" + item.transactionHash.toLowerCase() + ":" + item.logIndex;
  if (value.identityKey !== null && value.identityKey.length > 0) return item.provider + ":" + value.identityKey;
  return null;
}

function compareCollectedItems(first: CollectedItem, second: CollectedItem): number {
  const byBlock = compareDecimal(first.item.blockNumber, second.item.blockNumber);
  if (byBlock !== 0) return byBlock;
  const byTransaction = compareNullableDecimal(first.item.transactionIndex, second.item.transactionIndex);
  if (byTransaction !== 0) return byTransaction;
  const byLog = compareNullableDecimal(first.item.logIndex, second.item.logIndex);
  if (byLog !== 0) return byLog;
  const byHash = first.item.transactionHash.localeCompare(second.item.transactionHash);
  return byHash !== 0 ? byHash : first.identity.localeCompare(second.identity);
}

function compareDecimal(first: string, second: string): number {
  const a = BigInt(first);
  const b = BigInt(second);
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareNullableDecimal(first: string | null, second: string | null): number {
  if (first === null) return second === null ? 0 : 1;
  if (second === null) return -1;
  return compareDecimal(first, second);
}

function coversExactly(completed: readonly ClosedWindow[], startBlock: string, endBlock: string): boolean {
  const ordered = [...completed].sort((first, second) => compareDecimal(first.startBlock, second.startBlock));
  let next = BigInt(startBlock);
  for (const window of ordered) {
    if (BigInt(window.startBlock) !== next || BigInt(window.endBlock) < next) return false;
    next = BigInt(window.endBlock) + 1n;
  }
  return next === BigInt(endBlock) + 1n;
}

function stalled(completedWindows: number, message: string): EvmDataError {
  return new EvmDataError({
    code: "BLOCK_RANGE_STALLED",
    message: message + " Completed windows: " + completedWindows + ".",
    retryable: false,
  });
}

function incomplete(window: ClosedWindow, completedWindows: number, cause: unknown): EvmDataError {
  const provider = isEvmDataError(cause) && cause.provider !== null ? cause.provider : null;
  return new EvmDataError({
    code: "BLOCK_RANGE_INCOMPLETE",
    message: "Block-range scan stopped before window " + window.startBlock + "-" + window.endBlock + " completed; completed windows: " + completedWindows + (provider === null ? "." : "; provider: " + provider + "."),
    retryable: false,
    ...(provider === null ? {} : { provider }),
    ...(cause === undefined ? {} : { cause }),
  });
}
