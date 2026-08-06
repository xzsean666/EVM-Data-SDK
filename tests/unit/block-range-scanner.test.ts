import { describe, expect, it } from "vitest";

import { BlockRangeScanner } from "../../src/execution/BlockRangeScanner";
import type { RequestExecutor } from "../../src/execution/RequestExecutor";
import { EvmDataError } from "../../src/domain/errors";
import { normalizeErc20BlockRangeRequest } from "../../src/domain/operations";
import type { Erc20Transfer } from "../../src/domain/models";
import type { ProviderBlockRangeWindowResult } from "../../src/providers/DataProviderAdapter";

const address = "0x1111111111111111111111111111111111111111";

describe("BlockRangeScanner", () => {
  it("splits incomplete closed windows, rotates providers between windows, and sorts completed records", async () => {
    const requests: { startBlock: string; endBlock: string; providerOffset: number }[] = [];
    const executor = {
      execute: async (request: { startBlock: string; endBlock: string }, providerOffset = 0) => {
        requests.push({ startBlock: request.startBlock, endBlock: request.endBlock, providerOffset });
        if (request.startBlock === "10" && request.endBlock === "13") {
          return execution([], false, "alchemy");
        }
        if (request.startBlock === "10") {
          return execution([item("11", "2", "4", "etherscan")], true, "etherscan");
        }
        return execution([item("12", "1", "3", "moralis")], true, "moralis", 2);
      },
    } as unknown as RequestExecutor;
    const scanner = new BlockRangeScanner({ executor, maxRangeRecords: 10, maxRangeWindows: 10 });

    const result = await scanner.scan(request("10", "13"));

    expect(requests).toEqual([
      { startBlock: "10", endBlock: "13", providerOffset: 0 },
      { startBlock: "10", endBlock: "11", providerOffset: 1 },
      { startBlock: "12", endBlock: "13", providerOffset: 2 },
    ]);
    expect(result.providers).toEqual(["etherscan", "moralis"]);
    expect(result.stats).toEqual({
      windows: 2,
      upstreamRequests: 4,
      duplicateItemsRemoved: 0,
      providerWindows: { etherscan: 1, moralis: 1 },
    });
    expect(result.items.map((value) => value.blockNumber)).toEqual(["11", "12"]);
  });

  it("uses identity de-duplication without fabricating a log index", async () => {
    const executor = {
      execute: async (request: { startBlock: string }) => execution([
        item(request.startBlock, "0", null, "alchemy", "documented-asset-id"),
        item(request.startBlock, "1", null, "alchemy", "documented-asset-id"),
      ], true, "alchemy"),
    } as unknown as RequestExecutor;
    const scanner = new BlockRangeScanner({ executor, maxRangeRecords: 10, maxRangeWindows: 1 });

    const result = await scanner.scan(request("99", "99"));

    expect(result.items).toHaveLength(1);
    expect(result.stats.duplicateItemsRemoved).toBe(1);
    expect(result.items[0]?.logIndex).toBeNull();
  });

  it("fails closed when a provider cannot prove a dense single-block window is complete", async () => {
    const executor = {
      execute: async () => execution([], false, "etherscan"),
    } as unknown as RequestExecutor;
    const scanner = new BlockRangeScanner({ executor, maxRangeRecords: 10, maxRangeWindows: 10 });

    const error = await scanner.scan(request("42", "42")).catch((value: unknown) => value);

    expect(error).toMatchObject({ code: "BLOCK_RANGE_STALLED" });
  });

  it("fails closed when a completed item lacks both log index and provider identity", async () => {
    const executor = {
      execute: async () => execution([item("42", "0", null, "moralis", null)], true, "moralis"),
    } as unknown as RequestExecutor;
    const scanner = new BlockRangeScanner({ executor, maxRangeRecords: 10, maxRangeWindows: 1 });

    const error = await scanner.scan(request("42", "42")).catch((value: unknown) => value);

    expect(error).toMatchObject({ code: "BLOCK_RANGE_STALLED" });
  });

  it("reports a non-stalled provider failure as incomplete without returning partial data", async () => {
    const executor = {
      execute: async () => {
        throw new EvmDataError({
          code: "PROVIDER_UNAVAILABLE",
          message: "upstream unavailable",
          retryable: true,
          provider: "moralis",
          chainId: 1,
        });
      },
    } as unknown as RequestExecutor;
    const scanner = new BlockRangeScanner({ executor, maxRangeRecords: 10, maxRangeWindows: 1 });

    const error = await scanner.scan(request("1", "1")).catch((value: unknown) => value);

    expect(error).toMatchObject({ code: "BLOCK_RANGE_INCOMPLETE", provider: "moralis" });
    expect((error as Error).message).toContain("completed windows: 0");
  });

  it("enforces the configured record and window safety limits", async () => {
    const recordExecutor = {
      execute: async () => execution([item("1", "0", "1", "etherscan"), item("1", "1", "2", "etherscan")], true, "etherscan"),
    } as unknown as RequestExecutor;
    const recordScanner = new BlockRangeScanner({ executor: recordExecutor, maxRangeRecords: 1, maxRangeWindows: 1 });
    await expect(recordScanner.scan(request("1", "1"))).rejects.toMatchObject({ code: "RANGE_RESULT_TOO_LARGE" });

    const splitExecutor = { execute: async () => execution([], false, "alchemy") } as unknown as RequestExecutor;
    const splitScanner = new BlockRangeScanner({ executor: splitExecutor, maxRangeRecords: 10, maxRangeWindows: 1 });
    await expect(splitScanner.scan(request("1", "2"))).rejects.toMatchObject({ code: "BLOCK_RANGE_STALLED" });
  });
});

function request(startBlock: string, endBlock: string) {
  return normalizeErc20BlockRangeRequest({ chain: 1, address, startBlock, endBlock });
}

function item(
  blockNumber: string,
  transactionIndex: string,
  logIndex: string | null,
  provider: Erc20Transfer["provider"],
  identityKey: string | null = null,
) {
  const item: Erc20Transfer = {
    chainId: 1,
    transactionHash: "0x" + String(logIndex ?? transactionIndex).padStart(64, "0"),
    transactionIndex,
    logIndex,
    blockNumber,
    timestamp: null,
    tokenAddress: "0x2222222222222222222222222222222222222222",
    tokenName: null,
    tokenSymbol: null,
    tokenDecimals: 18,
    from: address,
    to: "0x3333333333333333333333333333333333333333",
    amount: "1",
    provider,
  };
  return { item, identityKey };
}

function execution(
  items: readonly ReturnType<typeof item>[],
  complete: boolean,
  provider: Erc20Transfer["provider"],
  upstreamRequests = 1,
): { result: ProviderBlockRangeWindowResult; upstreamRequests: number } {
  return {
    result: { items, complete, pageInfo: { provider, chainId: 1 } },
    upstreamRequests,
  };
}
