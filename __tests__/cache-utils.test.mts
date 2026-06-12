import { describe, it, expect, vi, afterEach } from "vitest";
import {
  durationInMilliseconds,
  ValkeyCacheTypeError,
  serializeValue,
  decodeValue,
} from "../cache-utils.mts";
import { gzip } from "node:zlib";
import { promisify } from "node:util";

const gzipAsync = promisify(gzip);

describe("ValkeyCacheTypeError", () => {
  it("creates an error with the correct name and prefixed message", () => {
    const err = new ValkeyCacheTypeError("test message");
    expect(err.name).toBe("ValkeyCacheTypeError");
    expect(err.message).toBe("ValkeyCache: test message");
    expect(err).toBeInstanceOf(TypeError);
  });
});

describe("serializeValue", () => {
  it("throws error for text mode with non-string", async () => {
    await expect(serializeValue(123, "text")).rejects.toThrow(
      new ValkeyCacheTypeError("text mode requires a string value"),
    );
  });

  it("returns string for text mode", async () => {
    const result = await serializeValue("hello", "text");
    expect(result).toBe("hello");
  });

  it("throws error for buffer mode with non-buffer", async () => {
    await expect(serializeValue("hello", "buffer")).rejects.toThrow(
      new ValkeyCacheTypeError("buffer mode requires a Buffer value"),
    );
  });

  it("returns buffer for buffer mode", async () => {
    const buf = Buffer.from("hello");
    const result = await serializeValue(buf, "buffer");
    expect(result).toBe(buf);
  });

  it("jsonifies value for json mode", async () => {
    const result = await serializeValue({ a: 1 }, "json");
    expect(result).toBe('{"a":1}');
  });

  it("compresses large values", async () => {
    const largeString = "a".repeat(3000); // > 2kb
    const result = await serializeValue(largeString, "text");
    expect(Buffer.isBuffer(result)).toBe(true);
    // Check if gzipped (magic number 0x1f 0x8b)
    expect((result as Buffer)[0]).toBe(0x1f);
    expect((result as Buffer)[1]).toBe(0x8b);
  });
});

describe("decodeValue", () => {
  it("returns null for null result", async () => {
    const result = await decodeValue(null, "text");
    expect(result).toBeNull();
  });

  it("throws error if result is not a buffer", async () => {
    await expect(decodeValue("string" as any, "text")).rejects.toThrow(
      new ValkeyCacheTypeError("Expected Buffer, got string"),
    );
  });

  it("returns buffer for buffer mode", async () => {
    const buf = Buffer.from("hello");
    const result = await decodeValue(buf, "buffer");
    expect(result).toBeInstanceOf(Buffer);
    expect((result as Buffer).toString()).toBe("hello");
  });

  it("returns string for text mode", async () => {
    const buf = Buffer.from("hello");
    const result = await decodeValue(buf, "text");
    expect(result).toBe("hello");
  });

  it("returns parsed JSON for json mode", async () => {
    const buf = Buffer.from('{"a":1}');
    const result = await decodeValue(buf, "json");
    expect(result).toEqual({ a: 1 });
  });

  it("decompresses gzipped values", async () => {
    const largeString = "a".repeat(3000); // > 2kb
    const gzipped = await gzipAsync(Buffer.from(largeString));
    const result = await decodeValue(gzipped, "text");
    expect(result).toBe(largeString);
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
