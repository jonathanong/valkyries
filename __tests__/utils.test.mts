import { describe, expect, it } from "vitest";
import { normalizeTtlResult, normalizeCountResult, validatePrefixAndTtl } from "../utils.mts";

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

describe("normalizeTtlResult", () => {
  it("should handle positive numbers by converting milliseconds to seconds", () => {
    expect(normalizeTtlResult(5000)).toBe(5);
    expect(normalizeTtlResult(1500)).toBe(1);
    expect(normalizeTtlResult(0)).toBe(0);
  });

  it("should preserve sentinel number values", () => {
    expect(normalizeTtlResult(-1)).toBe(-1);
    expect(normalizeTtlResult(-2)).toBe(-2);
  });

  it("should return null for invalid negative number values", () => {
    expect(normalizeTtlResult(-3)).toBeNull();
    expect(normalizeTtlResult(-1500)).toBeNull();
  });

  it("should return null for invalid number inputs", () => {
    expect(normalizeTtlResult(NaN)).toBeNull();
    expect(normalizeTtlResult(Infinity)).toBeNull();
    expect(normalizeTtlResult(-Infinity)).toBeNull();
  });

  it("should handle positive bigints by converting milliseconds to seconds", () => {
    expect(normalizeTtlResult(5000n)).toBe(5);
    expect(normalizeTtlResult(1500n)).toBe(1);
    expect(normalizeTtlResult(0n)).toBe(0);
  });

  it("should preserve sentinel bigint values as numbers", () => {
    expect(normalizeTtlResult(-1n)).toBe(-1);
    expect(normalizeTtlResult(-2n)).toBe(-2);
  });

  it("should return null for invalid bigint values", () => {
    expect(normalizeTtlResult(-3n)).toBeNull();
    expect(normalizeTtlResult(-1500n)).toBeNull();
  });

  it("should return null for unknown or invalid inputs", () => {
    expect(normalizeTtlResult(null)).toBeNull();
    expect(normalizeTtlResult(undefined)).toBeNull();
    expect(normalizeTtlResult("5000")).toBeNull();
    expect(normalizeTtlResult({})).toBeNull();
    expect(normalizeTtlResult([])).toBeNull();
    expect(normalizeTtlResult(true)).toBeNull();
  });
});

describe("normalizeCountResult", () => {
  it("should return number values as is", () => {
    expect(normalizeCountResult(5)).toBe(5);
    expect(normalizeCountResult(0)).toBe(0);
    expect(normalizeCountResult(-5)).toBe(-5);
  });

  it("should return 0 for invalid number inputs", () => {
    expect(normalizeCountResult(NaN)).toBe(0);
    expect(normalizeCountResult(Infinity)).toBe(0);
    expect(normalizeCountResult(-Infinity)).toBe(0);
  });

  it("should convert bigint values to numbers", () => {
    expect(normalizeCountResult(5n)).toBe(5);
    expect(normalizeCountResult(0n)).toBe(0);
    expect(normalizeCountResult(-5n)).toBe(-5);
  });

  it("should return 0 for unknown or invalid inputs", () => {
    expect(normalizeCountResult(null)).toBe(0);
    expect(normalizeCountResult(undefined)).toBe(0);
    expect(normalizeCountResult("5")).toBe(0);
    expect(normalizeCountResult({})).toBe(0);
    expect(normalizeCountResult([])).toBe(0);
    expect(normalizeCountResult(true)).toBe(0);
  });
});
