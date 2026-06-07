import { describe, expect, it } from "vitest";

import { normalizeKey } from "../key-normalization.mts";

describe("normalizeKey", () => {
  it("trims whitespace from the beginning and end", () => {
    expect(normalizeKey("  hello  ")).toBe("hello");
  });

  it("converts uppercase characters to lowercase", () => {
    expect(normalizeKey("HELLO")).toBe("hello");
  });

  it("handles mixed case and whitespace", () => {
    expect(normalizeKey("  HeLlO wOrLd  ")).toBe("hello world");
  });

  it("handles empty strings", () => {
    expect(normalizeKey("")).toBe("");
  });

  it("handles strings with only whitespace", () => {
    expect(normalizeKey("   ")).toBe("");
  });
});
