import { describe, it, expect, vi, afterEach } from "vitest";
import { durationInMilliseconds, decodeValue } from "../cache-utils.mts";

describe("decodeValue", () => {
  it("prevents prototype pollution via JSON.parse", async () => {
    const payload =
      '{"__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}}, "safe": 1}';
    const buffer = Buffer.from(payload);
    const result = await decodeValue(buffer, "json");

    expect(result).toEqual({ safe: 1 });
    expect({}.hasOwnProperty("polluted")).toBe(false);
    expect((result as any).__proto__.polluted).toBeUndefined();
    expect((result as any).constructor.prototype?.polluted).toBeUndefined();
  });
});

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
