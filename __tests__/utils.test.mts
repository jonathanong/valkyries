import { describe, expect, it } from "vitest";
import { validatePrefixAndTtl } from "../utils.mts";

describe("validatePrefixAndTtl", () => {
  it("rejects whitespace-only prefix", () => {
    expect(() => {
      validatePrefixAndTtl("   ", 10, "Component");
    }).toThrow("Component requires a prefix");
  });

  it("rejects non-finite TTL values", () => {
    expect(() => {
      validatePrefixAndTtl("test", Number.POSITIVE_INFINITY, "Component");
    }).toThrow("Component: ttlSeconds must be greater than 0");
  });
});
