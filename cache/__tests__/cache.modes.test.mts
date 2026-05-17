import { ValkeyCache } from "../../cache.mts";
import { it, expect, describe } from "vitest";

describe("cache.modes", () => {
  it("ValkeyCache text mode", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, mode: "text" });
    const key = `test-${Math.random().toString(36).slice(2)}`;
    const value = "raw text value";
    await cache.set(key, value);
    expect(await cache.get(key)).toBe(value);
    await cache.delete(key);
    expect(await cache.get(key)).toBeNull();
  });

  it("ValkeyCache text mode rejects non-string", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, mode: "text" });
    const key = `test-${Math.random().toString(36).slice(2)}`;
    await expect(cache.set(key, { test: "test" })).rejects.toThrow(
      "ValkeyCache: text mode requires a string value",
    );
  });

  it("ValkeyCache buffer mode", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, mode: "buffer" });
    const key = `test-${Math.random().toString(36).slice(2)}`;
    const value = Buffer.from("raw buffer data", "utf8");
    await cache.set(key, value);
    const result = await cache.get(key);
    expect(Buffer.isBuffer(result)).toBe(true);
    expect(result).toEqual(value);
    await cache.delete(key);
    expect(await cache.get(key)).toBeNull();
  });

  it("ValkeyCache buffer mode rejects non-buffer", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, mode: "buffer" });
    const key = `test-${Math.random().toString(36).slice(2)}`;
    await expect(cache.set(key, "not a buffer")).rejects.toThrow(
      "ValkeyCache: buffer mode requires a Buffer value",
    );
  });
});
