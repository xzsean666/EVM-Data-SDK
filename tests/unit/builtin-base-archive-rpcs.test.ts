import { describe, expect, it } from "vitest";
import { BUILTIN_BASE_ARCHIVE_RPCS } from "../../src/rpc/builtinBaseArchiveRpcs";

describe("BUILTIN_BASE_ARCHIVE_RPCS", () => {
  it("contains frozen, unique HTTPS candidates for Base failover", () => {
    expect(BUILTIN_BASE_ARCHIVE_RPCS.length).toBeGreaterThanOrEqual(2);
    expect(new Set(BUILTIN_BASE_ARCHIVE_RPCS.map((candidate) => candidate.id)).size).toBe(BUILTIN_BASE_ARCHIVE_RPCS.length);
    expect(new Set(BUILTIN_BASE_ARCHIVE_RPCS.map((candidate) => candidate.url)).size).toBe(BUILTIN_BASE_ARCHIVE_RPCS.length);
    expect(Object.isFrozen(BUILTIN_BASE_ARCHIVE_RPCS)).toBe(true);
    for (const candidate of BUILTIN_BASE_ARCHIVE_RPCS) expect(new URL(candidate.url).protocol).toBe("https:");
  });
});
