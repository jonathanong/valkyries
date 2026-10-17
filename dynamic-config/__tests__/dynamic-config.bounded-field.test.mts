import { describe, expect, it } from "vitest";
import { getBoundedPositiveIntegerField } from "../bounded-field.mts";

const limits = { defaultValue: 10, maxValue: 100 };

function read(value?: string | number | boolean) {
  const fields = new Map<string, string | number | boolean>();
  if (value !== undefined) fields.set("limit", value);
  return getBoundedPositiveIntegerField({ fields }, "limit", limits);
}

describe("getBoundedPositiveIntegerField", () => {
  it("returns the default for a missing field", () => {
    expect(read()).toBe(10);
  });

  it("returns the default for non-number values", () => {
    expect(read("50")).toBe(10);
    expect(read(true)).toBe(10);
  });

  it("returns the default for non-integer, non-finite, zero, and negative numbers", () => {
    expect(read(1.5)).toBe(10);
    expect(read(Number.NaN)).toBe(10);
    expect(read(0)).toBe(10);
    expect(read(-5)).toBe(10);
  });

  it("returns the default, not the max, for values above max", () => {
    expect(read(101)).toBe(10);
  });

  it("accepts exactly the max and valid values", () => {
    expect(read(100)).toBe(100);
    expect(read(1)).toBe(1);
    expect(read(42)).toBe(42);
  });
});
