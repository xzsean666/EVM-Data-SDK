import { describe, expect, it, vi } from "vitest";

import { AddressService } from "../../src/services/AddressService";

const address = "0x1111111111111111111111111111111111111111";

describe("AddressService block-range callbacks", () => {
  it("emits a normalized internal-native range and does not retain callback items", async () => {
    const indexedApi = {
      getInternalNativeTransfersByBlockRange: vi.fn().mockResolvedValue({
        chainId: 1,
        address,
        range: { startBlock: "1", endBlock: "999" },
        items: [{
          chainId: 1,
          transactionHash: "0xabc",
          traceId: "0",
          blockNumber: "42",
          timestamp: "2026-01-01T00:00:00.000Z",
          from: address,
          to: "0x2222222222222222222222222222222222222222",
          value: "1",
          type: "call",
          status: "success",
          provider: "etherscan",
        }],
        provider: "etherscan",
        pages: 1,
        upstreamRequests: 1,
      }),
    };
    const service = new AddressService({ execute: vi.fn() } as never, indexedApi as never, { maxRangeRecords: 100, maxRangeWindows: 10 });
    const callback = vi.fn();

    const result = await service.getInternalNativeTransfersByBlockRange({
      chain: "ethereum",
      address,
      startBlock: "1",
      endBlock: "999",
      onWindow: callback,
    });

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      range: { startBlock: "1", endBlock: "999" },
      items: expect.arrayContaining([expect.objectContaining({ blockNumber: "42" })]),
      provider: "etherscan",
    }));
    expect(result.items).toEqual([]);
    expect(indexedApi.getInternalNativeTransfersByBlockRange).toHaveBeenCalledWith(expect.objectContaining({ startBlock: "1", endBlock: "999" }));
  });

  it("uses the same complete-range callback contract for Beacon withdrawals", async () => {
    const indexedApi = {
      getBeaconWithdrawalsByBlockRange: vi.fn().mockResolvedValue({
        chainId: 1,
        address,
        range: { startBlock: "10", endBlock: "20" },
        items: [],
        provider: "etherscan",
        pages: 1,
        upstreamRequests: 1,
      }),
    };
    const service = new AddressService({ execute: vi.fn() } as never, indexedApi as never, { maxRangeRecords: 100, maxRangeWindows: 10 });
    const callback = vi.fn();

    const result = await service.getBeaconWithdrawalsByBlockRange({
      chain: "ethereum",
      address,
      startBlock: "10",
      endBlock: "20",
      onWindow: callback,
    });

    expect(callback).toHaveBeenCalledWith(expect.objectContaining({
      range: { startBlock: "10", endBlock: "20" },
      items: [],
      provider: "etherscan",
    }));
    expect(result.items).toEqual([]);
  });

  it("keeps the complete callback range intact for large scans", async () => {
    const indexedApi = {
      getInternalNativeTransfersByBlockRange: vi.fn(async (input: { startBlock: string; endBlock: string }) => ({
        chainId: 1,
        address,
        range: { startBlock: input.startBlock, endBlock: input.endBlock },
        items: [],
        provider: "etherscan" as const,
        pages: 1,
        upstreamRequests: 1,
      })),
    };
    const service = new AddressService({ execute: vi.fn() } as never, indexedApi as never, { maxRangeRecords: 100, maxRangeWindows: 10 });
    const callback = vi.fn();

    const result = await service.getInternalNativeTransfersByBlockRange({
      chain: "ethereum",
      address,
      startBlock: "1",
      endBlock: "200001",
      onWindow: callback,
    });

    expect(indexedApi.getInternalNativeTransfersByBlockRange).toHaveBeenCalledTimes(1);
    expect(indexedApi.getInternalNativeTransfersByBlockRange).toHaveBeenCalledWith(expect.objectContaining({ startBlock: "1", endBlock: "200001" }));
    expect(callback).toHaveBeenCalledTimes(1);
    expect(result.items).toEqual([]);
    expect(result.range).toEqual({ startBlock: "1", endBlock: "200001" });
  });
});
