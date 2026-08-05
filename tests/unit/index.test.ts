import * as sdk from "../../src/index";
import { describe, expect, it } from "vitest";

describe("package surface", () => {
  it("loads the domain and chain registry surface without side effects", () => {
    expect(sdk).toBeDefined();
    expect(sdk.EvmDataError).toBeTypeOf("function");
  });
});
