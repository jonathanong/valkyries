import { describe, it, expect, vi } from "vitest";
import { durationInMilliseconds } from "../cache-utils.mts";

describe("cache-utils", () => {
  describe("durationInMilliseconds", () => {
    it("should calculate duration correctly", () => {
      // 5_000_000 nanoseconds = 5 milliseconds
      const start = BigInt(100_000_000);
      const end = BigInt(105_000_000);

      vi.spyOn(process.hrtime, "bigint").mockReturnValue(end);

      const duration = durationInMilliseconds(start);

      expect(duration).toBe(5);

      vi.restoreAllMocks();
    });

    it("should handle zero duration", () => {
      const start = BigInt(100_000_000);
      const end = BigInt(100_000_000);

      vi.spyOn(process.hrtime, "bigint").mockReturnValue(end);

      const duration = durationInMilliseconds(start);

      expect(duration).toBe(0);

      vi.restoreAllMocks();
    });
  });
});
