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
    });

    it("should return the number equivalent when input is a bigint", () => {
      expect(normalizeCountResult(5n)).toBe(5);
      expect(normalizeCountResult(0n)).toBe(0);
      expect(normalizeCountResult(-1n)).toBe(-1);
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
