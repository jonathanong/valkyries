import { describe, expect, it } from "vitest";
import { normalizeCountResult, normalizeTtlResult } from "../utils.mts";

describe("utils", () => {
  describe("normalizeTtlResult", () => {
    it("should handle valid positive number inputs (milliseconds to seconds)", () => {
      expect(normalizeTtlResult(1500)).toBe(1);
      expect(normalizeTtlResult(2000)).toBe(2);
      expect(normalizeTtlResult(0)).toBe(0);
      expect(normalizeTtlResult(999)).toBe(0);
    });

    it("should preserve number sentinel values (-1, -2)", () => {
      expect(normalizeTtlResult(-1)).toBe(-1);
      expect(normalizeTtlResult(-2)).toBe(-2);
    });

    it("should handle valid positive bigint inputs (milliseconds to seconds)", () => {
      expect(normalizeTtlResult(1500n)).toBe(1);
      expect(normalizeTtlResult(2000n)).toBe(2);
      expect(normalizeTtlResult(0n)).toBe(0);
      expect(normalizeTtlResult(999n)).toBe(0);
    });

    it("should preserve bigint sentinel values (-1, -2)", () => {
      expect(normalizeTtlResult(-1n)).toBe(-1);
      expect(normalizeTtlResult(-2n)).toBe(-2);
    });

    it("should truncate small negative values instead of rounding to -1", () => {
      // Math.trunc(-0.5) is -0, which vitest asserts exactly via Object.is equality,
      // so we use Object.is or expect(X).toBe(-0) to avoid failures.
      expect(normalizeTtlResult(-500)).toBe(-0);
      expect(normalizeTtlResult(-999)).toBe(-0);
      // For bigints, Number(-500n) / 1000 is also -0.5, truncated to -0.
      expect(normalizeTtlResult(-500n)).toBe(-0);
      expect(normalizeTtlResult(-999n)).toBe(-0);
    });

    it("should handle edge case number values correctly", () => {
      expect(normalizeTtlResult(NaN)).toBeNaN();
      expect(normalizeTtlResult(Infinity)).toBe(Infinity);
      expect(normalizeTtlResult(-Infinity)).toBe(-Infinity);

      // -0 should return -0 or 0, Math.trunc(-0) is -0, Object.is differentiates them
      // Math.trunc(-0 / 1000) === -0
      expect(Object.is(normalizeTtlResult(-0), -0)).toBe(true);

      // Math.trunc(Number.MAX_SAFE_INTEGER / 1000)
      expect(normalizeTtlResult(Number.MAX_SAFE_INTEGER)).toBe(9007199254740);
      expect(normalizeTtlResult(Number.MIN_SAFE_INTEGER)).toBe(-9007199254740);
    });

    it("should return null for invalid types", () => {
      expect(normalizeTtlResult(null)).toBeNull();
      expect(normalizeTtlResult(undefined)).toBeNull();
      expect(normalizeTtlResult("1000")).toBeNull();
      expect(normalizeTtlResult({})).toBeNull();
      expect(normalizeTtlResult([])).toBeNull();
      expect(normalizeTtlResult(true)).toBeNull();
    });
  });

  describe("normalizeCountResult", () => {
    it("should return the number when input is a number", () => {
      expect(normalizeCountResult(5)).toBe(5);
      expect(normalizeCountResult(0)).toBe(0);
      expect(normalizeCountResult(-1)).toBe(-1);
      expect(normalizeCountResult(3.14)).toBe(3.14);
      expect(normalizeCountResult(NaN)).toBeNaN();
      expect(normalizeCountResult(Infinity)).toBe(Infinity);
      expect(normalizeCountResult(-Infinity)).toBe(-Infinity);

      // Safe-integer boundaries pass through unchanged.
      expect(normalizeCountResult(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
      expect(normalizeCountResult(Number.MIN_SAFE_INTEGER)).toBe(Number.MIN_SAFE_INTEGER);

      // Negative zero is preserved as -0 (Object.is distinguishes it from 0).
      expect(Object.is(normalizeCountResult(-0), -0)).toBe(true);
    });

    it("should return the number equivalent when input is a bigint", () => {
      expect(normalizeCountResult(5n)).toBe(5);
      expect(normalizeCountResult(0n)).toBe(0);
      expect(normalizeCountResult(-1n)).toBe(-1);

      // Safe-integer boundaries round-trip exactly.
      expect(normalizeCountResult(BigInt(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
      expect(normalizeCountResult(BigInt(Number.MIN_SAFE_INTEGER))).toBe(Number.MIN_SAFE_INTEGER);

      // Beyond Number.MAX_SAFE_INTEGER the bigint coerces to the nearest
      // double; 2^53 + 1 is not representable and rounds down to 2^53.
      const largeBigInt = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
      expect(normalizeCountResult(largeBigInt)).toBe(9007199254740992);
    });

    it("should return 0 for invalid types", () => {
      expect(normalizeCountResult(null)).toBe(0);
      expect(normalizeCountResult(undefined)).toBe(0);
      expect(normalizeCountResult("5")).toBe(0);
      expect(normalizeCountResult({})).toBe(0);
      expect(normalizeCountResult([])).toBe(0);
      expect(normalizeCountResult(true)).toBe(0);
    });
  });
});
