import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import * as api from "../index.mts";
import { decodeValue, serializeValue } from "../cache-utils.mts";
import { setValkeyErrorHandler, handleValkeyError } from "../errors.mts";
import { emitValkeyEvent, valkeyEvents } from "../events.mts";
import { normalizeKey } from "../key-normalization.mts";

describe("public api", () => {
  it("exports the package surface", () => {
    expect(api.ValkeyCache).toBeTypeOf("function");
    expect(Reflect.get(api.ValkeyCache, "deleteFromCaches")).toBeTypeOf("function");
    expect(api.ValkeyBloomFilter).toBeTypeOf("function");
    expect(api.DynamicConfig).toBeTypeOf("function");
    expect(api.RateLimiter).toBeTypeOf("function");
    expect(api.closeValkeyClients).toBeTypeOf("function");
    expect(api.isRetryableValkeyError).toBeTypeOf("function");
    expect(api.retryValkeyOperation).toBeTypeOf("function");
  });

  it("normalizes keys", () => {
    expect(normalizeKey("  AbC  ")).toBe("abc");
  });

  it("serializes and decodes cache values across modes", async () => {
    const json = await serializeValue({ ok: true }, "json");
    expect(await decodeValue(Buffer.from(json), "json")).toEqual({ ok: true });

    const text = await serializeValue("hello", "text");
    expect(await decodeValue(Buffer.from(text), "text")).toBe("hello");

    const buffer = await serializeValue(Buffer.from("hello"), "buffer");
    expect(await decodeValue(Buffer.from(buffer), "buffer")).toEqual(Buffer.from("hello"));

    const large = await serializeValue({ data: "x".repeat(3_000) }, "json");
    expect(Buffer.isBuffer(large)).toBe(true);
    expect(await decodeValue(large, "json")).toEqual({ data: "x".repeat(3_000) });
    expect(await decodeValue(null, "json")).toBeNull();
  });

  it("uses the configured error handler", () => {
    const handler = vi.fn();
    setValkeyErrorHandler(handler);

    handleValkeyError("boom");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect(handler.mock.calls[0]![0].message).toBe("boom");
  });

  it("routes event handler failures to the configured error handler", () => {
    const errorHandler = vi.fn();
    const eventHandler = vi.fn(() => {
      throw new Error("handler failed");
    });
    setValkeyErrorHandler(errorHandler);
    valkeyEvents.on("cache:hit", eventHandler);
    try {
      emitValkeyEvent("cache:hit", { cacheName: "test", keys: ["a"], count: 1 });
    } finally {
      valkeyEvents.off("cache:hit", eventHandler);
    }

    expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
  });
});
