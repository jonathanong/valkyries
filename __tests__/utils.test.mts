import { describe, it, expect } from "vitest";
import { normalizeCountResult, normalizeTtlResult } from "../utils.mts";

describe("utils", () => {
  describe("normalizeCountResult", () => {
    it("should return the number when given a number", () => {
      expect(normalizeCountResult(5)).toBe(5);
      expect(normalizeCountResult(0)).toBe(0);
      expect(normalizeCountResult(-1)).toBe(-1);
    });

    it("should convert bigint to number", () => {
      expect(normalizeCountResult(5n)).toBe(5);
      expect(normalizeCountResult(0n)).toBe(0);
      expect(normalizeCountResult(-1n)).toBe(-1);
    });

    it("should return 0 for unhandled types", () => {
      expect(normalizeCountResult(null)).toBe(0);
      expect(normalizeCountResult(undefined)).toBe(0);
      expect(normalizeCountResult("5")).toBe(0);
      expect(normalizeCountResult({})).toBe(0);
    });
  });

  describe("normalizeTtlResult", () => {
    it("should return sentinel values directly for numbers", () => {
      expect(normalizeTtlResult(-1)).toBe(-1);
      expect(normalizeTtlResult(-2)).toBe(-2);
    });

    it("should convert milliseconds to seconds for positive numbers", () => {
      expect(normalizeTtlResult(1000)).toBe(1);
      expect(normalizeTtlResult(1500)).toBe(1);
      expect(normalizeTtlResult(500)).toBe(0);
    });

    it("should return sentinel values directly for bigints", () => {
      expect(normalizeTtlResult(-1n)).toBe(-1);
      expect(normalizeTtlResult(-2n)).toBe(-2);
    });

    it("should convert bigint milliseconds to number seconds", () => {
      expect(normalizeTtlResult(1000n)).toBe(1);
      expect(normalizeTtlResult(1500n)).toBe(1);
      expect(normalizeTtlResult(500n)).toBe(0);
    });

    it("should return null for unhandled types", () => {
      expect(normalizeTtlResult(null)).toBeNull();
      expect(normalizeTtlResult(undefined)).toBeNull();
      expect(normalizeTtlResult("1000")).toBeNull();
      expect(normalizeTtlResult({})).toBeNull();
    });
  });
});
