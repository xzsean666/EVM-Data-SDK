import { describe, expect, it } from "vitest";

import { BUILTIN_ETHEREUM_ARCHIVE_RPCS } from "../../src/rpc/builtinEthereumArchiveRpcs";

describe("BUILTIN_ETHEREUM_ARCHIVE_RPCS", () => {
  it("contains at least two candidates for failover", () => {
    expect(BUILTIN_ETHEREUM_ARCHIVE_RPCS.length).toBeGreaterThanOrEqual(2);
  });

  it("has unique, non-empty stable ids", () => {
    const ids = BUILTIN_ETHEREUM_ARCHIVE_RPCS.map((candidate) => candidate.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.length).toBeGreaterThan(0);
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("has unique HTTPS urls without path, query, or credentials", () => {
    const urls = BUILTIN_ETHEREUM_ARCHIVE_RPCS.map((candidate) => candidate.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const url of urls) {
      const parsed = new URL(url);
      expect(parsed.protocol).toBe("https:");
      expect(parsed.username).toBe("");
      expect(parsed.password).toBe("");
      expect(parsed.search).toBe("");
      expect(parsed.hash).toBe("");
    }
  });

  it("is deeply frozen so callers cannot mutate the registry", () => {
    expect(Object.isFrozen(BUILTIN_ETHEREUM_ARCHIVE_RPCS)).toBe(true);
    expect(Object.isFrozen(BUILTIN_ETHEREUM_ARCHIVE_RPCS[0])).toBe(true);
  });
});
