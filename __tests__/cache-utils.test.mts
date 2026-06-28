import { describe, it, expect, vi, afterEach } from "vitest";
import { gzipSync } from "node:zlib";
import {
  durationInMilliseconds,
  ValkeyCacheTypeError,
  serializeValue,
  decodeValue,
} from "../cache-utils.mts";

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

describe("ValkeyCacheTypeError", () => {
  it("extends TypeError", () => {
    const error = new ValkeyCacheTypeError("test error");
    expect(error).toBeInstanceOf(TypeError);
  });

  it("formats the message correctly", () => {
    const error = new ValkeyCacheTypeError("test error");
    expect(error.message).toBe("ValkeyCache: test error");
  });

  it("sets the correct name", () => {
    const error = new ValkeyCacheTypeError("test error");
    expect(error.name).toBe("ValkeyCacheTypeError");
  });
});

describe("serializeValue", () => {
  it("serializes text mode correctly", async () => {
    const result = await serializeValue("hello", "text");
    expect(result).toBe("hello");
  });

  it("throws ValkeyCacheTypeError for non-string in text mode", async () => {
    await expect(serializeValue(123, "text")).rejects.toThrow(
      new ValkeyCacheTypeError("text mode requires a string value"),
    );
  });

  it("serializes buffer mode correctly", async () => {
    const buffer = Buffer.from("hello");
    const result = await serializeValue(buffer, "buffer");
    expect(result).toBe(buffer);
  });

  it("throws ValkeyCacheTypeError for non-buffer in buffer mode", async () => {
    await expect(serializeValue("hello", "buffer")).rejects.toThrow(
      new ValkeyCacheTypeError("buffer mode requires a Buffer value"),
    );
  });

  it("serializes json mode correctly", async () => {
    const obj = { key: "value" };
    const result = await serializeValue(obj, "json");
    expect(result).toBe('{"key":"value"}');
  });

  it("compresses payloads larger than 2KB", async () => {
    const largeString = "a".repeat(3000);
    const result = await serializeValue(largeString, "text");
    expect(Buffer.isBuffer(result)).toBe(true);
    if (Buffer.isBuffer(result)) {
      expect(result[0]).toBe(0x1f);
      expect(result[1]).toBe(0x8b);
    }
  });

  it("does not compress payloads smaller than 2KB", async () => {
    const smallString = "a".repeat(1000);
    const result = await serializeValue(smallString, "text");
    expect(result).toBe(smallString);
  });
});

describe("decodeValue", () => {
  it("returns null for null input", async () => {
    const result = await decodeValue(null, "text");
    expect(result).toBeNull();
  });

  it("throws ValkeyCacheTypeError if input is not a buffer", async () => {
    await expect(decodeValue("not a buffer" as any, "text")).rejects.toThrow(
      new ValkeyCacheTypeError("Expected Buffer, got string"),
    );
  });

  it("decompresses and decodes text mode", async () => {
    const originalString = "a".repeat(3000);
    const compressedBuffer = gzipSync(Buffer.from(originalString));
    const result = await decodeValue(compressedBuffer, "text");
    expect(result).toBe(originalString);
  });

  it("decodes uncompressed text mode", async () => {
    const buffer = Buffer.from("hello");
    const result = await decodeValue(buffer, "text");
    expect(result).toBe("hello");
  });

  it("decompresses and decodes buffer mode", async () => {
    const originalBuffer = Buffer.from("a".repeat(3000));
    const compressedBuffer = gzipSync(originalBuffer);
    const result = await decodeValue(compressedBuffer, "buffer");
    expect(result).toEqual(originalBuffer);
  });

  it("decodes uncompressed buffer mode", async () => {
    const buffer = Buffer.from("hello");
    const result = await decodeValue(buffer, "buffer");
    expect(result).toEqual(buffer);
  });

  it("decompresses and decodes json mode", async () => {
    const originalObj = { data: "a".repeat(3000) };
    const compressedBuffer = gzipSync(Buffer.from(JSON.stringify(originalObj)));
    const result = await decodeValue(compressedBuffer, "json");
    expect(result).toEqual(originalObj);
  });

  it("decodes uncompressed json mode", async () => {
    const obj = { key: "value" };
    const buffer = Buffer.from(JSON.stringify(obj));
    const result = await decodeValue(buffer, "json");
    expect(result).toEqual(obj);
  });
});
