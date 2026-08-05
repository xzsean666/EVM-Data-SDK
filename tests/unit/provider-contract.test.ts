import { describe, expect, it } from "vitest";

import { ChainRegistry } from "../../src/chains/ChainRegistry";
import { parseNativeBalanceRequest } from "../../src/domain/operations";
import type {
  CapabilityRequest,
  DataProviderAdapter,
  ProviderAttemptContext,
} from "../../src/providers/DataProviderAdapter";
import { isProviderName, validateProviderName } from "../../src/providers/DataProviderAdapter";

describe("DataProviderAdapter contract", () => {
  it("carries one attempt context and returns provider-neutral domain data", async () => {
    const chain = new ChainRegistry().resolve("ethereum");
    const request = parseNativeBalanceRequest({
      chain: "ethereum",
      address: "0x1234567890abcdef1234567890abcdef12345678",
    });
    const context: ProviderAttemptContext = {
      chain,
      credential: { id: "etherscan-key-1", value: "key-secret" },
      proxy: null,
      timeoutMs: 1_000,
      correlationId: "attempt-1",
    };
    const capability: CapabilityRequest = {
      operation: request.operation,
      chain,
      request,
      continuation: false,
    };
    let attempts = 0;
    const adapter: DataProviderAdapter = {
      name: "custom-provider",
      supports: (value) => value.operation === "getNativeBalance" && value.chain.chainId === 1,
      getNativeBalance: async (value, attemptContext) => {
        attempts += 1;
        expect(value).toBe(request);
        expect(attemptContext).toBe(context);
        return {
          chainId: attemptContext.chain.chainId,
          address: value.address,
          amount: "12345678901234567890",
          decimals: 18,
          symbol: "ETH",
          blockNumber: null,
          provider: adapter.name,
        };
      },
    };

    expect(isProviderName(adapter.name)).toBe(true);
    expect(validateProviderName(" custom-provider ")).toBe("custom-provider");
    expect(() => validateProviderName(" ")).toThrowError(
      expect.objectContaining({ code: "INVALID_CONFIGURATION" }),
    );
    expect(adapter.supports(capability)).toBe(true);
    const result = await adapter.getNativeBalance?.(request, context);
    expect(result).toMatchObject({ amount: "12345678901234567890", provider: "custom-provider" });
    expect(attempts).toBe(1);
  });
});
