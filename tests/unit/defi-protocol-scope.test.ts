import { describe, expect, it } from "vitest";

import { DEFI_PROTOCOL_SCOPE } from "../../src/defi/defiProtocolScope";

describe("DeFiLlama protocol scope", () => {
  it("freezes 50 unique DeFi protocols per supported chain", () => {
    for (const protocols of Object.values(DEFI_PROTOCOL_SCOPE)) {
      expect(protocols).toHaveLength(50);
      expect(new Set(protocols).size).toBe(50);
      expect(protocols.every((slug) => /^[a-z0-9.-]+$/.test(slug))).toBe(true);
    }
  });
});
