import { describe, it, expect, vi, afterEach } from "vitest";
import { durationInMilliseconds } from "../cache-utils.mts";

describe("durationInMilliseconds", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calculates the correct duration in milliseconds", () => {
    const mockBigint = vi.spyOn(process.hrtime, "bigint");
    mockBigint.mockReturnValue(5_000_000n);

    const start = 1_000_000n;
    const result = durationInMilliseconds(start);

    expect(result).toBe(4);
  });

  it("handles zero duration", () => {
    const mockBigint = vi.spyOn(process.hrtime, "bigint");
    mockBigint.mockReturnValue(1_000_000n);

    const start = 1_000_000n;
    const result = durationInMilliseconds(start);

    expect(result).toBe(0);
  });

  it("handles fractional milliseconds correctly", () => {
    const mockBigint = vi.spyOn(process.hrtime, "bigint");
    mockBigint.mockReturnValue(1_500_000n);

    const start = 1_000_000n;
    const result = durationInMilliseconds(start);

    expect(result).toBe(0.5);
  });
});
