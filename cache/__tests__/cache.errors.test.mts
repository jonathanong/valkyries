import { ValkeyCache } from "../../cache.mts";
import { decodeValue, ValkeyCacheTypeError } from "../../cache-utils.mts";
import { it, expect, describe } from "vitest";
import { cacheValkeyClient } from "../../clients.mts";

describe("cache.errors", () => {
  it("ValkeyCache handles corrupted gzip data gracefully", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const key = `test-${Math.random().toString(36).slice(2)}`;

    // Manually set corrupted gzip data
    const cacheKey = cache.getKey(key);
    // Set data that looks like gzip (starts with 0x1f 0x8b) but is corrupted
    // Use set with Buffer to store binary data
    const corruptedData = Buffer.from([0x1f, 0x8b, 0x00, 0x00, 0x00, 0x00]);
    await cacheValkeyClient.set(cacheKey, corruptedData);

    // The decode function throws errors in test mode to make them visible
    // The gunzip will fail with a compression-related error
    await expect(cache.get(key)).rejects.toThrow(Error);

    // Clean up the test key
    await cache.delete(key);
  });

  it("ValkeyCache handles corrupted JSON data gracefully", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const key = `test-${Math.random().toString(36).slice(2)}`;

    // Set corrupted JSON data using the cache's set method to ensure proper format
    // Then manually corrupt it in Valkey to simulate corruption
    await cache.set(key, { valid: "data" });

    const cacheKey = cache.getKey(key);
    // Overwrite with invalid JSON that can be decoded as UTF-8 but fails JSON.parse
    await cacheValkeyClient.set(cacheKey, Buffer.from("{invalid json", "utf8"));

    await expect(cache.get(key)).rejects.toThrow("Expected property name");

    // Clean up the test key
    await cache.delete(key);
  });

  it("ValkeyCache requires prefix", () => {
    expect(() => {
      // @ts-expect-error - testing invalid input
      // oxlint-disable-next-line no-new
      new ValkeyCache({ ttlSeconds: 10 });
    }).toThrow("ValkeyCache requires a prefix");

    expect(() => {
      // oxlint-disable-next-line no-new
      new ValkeyCache({ prefix: "", ttlSeconds: 10 });
    }).toThrow("ValkeyCache requires a prefix");
  });

  it("ValkeyCache requires ttlSeconds > 0", () => {
    expect(() => {
      // oxlint-disable-next-line no-new
      new ValkeyCache({ prefix: "test", ttlSeconds: 0 });
    }).toThrow("ValkeyCache: ttlSeconds must be greater than 0");

    expect(() => {
      // oxlint-disable-next-line no-new
      new ValkeyCache({ prefix: "test", ttlSeconds: -1 });
    }).toThrow("ValkeyCache: ttlSeconds must be greater than 0");
  });

  it("decodeValue throws ValkeyCacheTypeError when result is a non-Buffer string", async () => {
    // Passing a plain string (not a Buffer) triggers the explicit guard in decodeValue.
    // This path can occur if a Glide client decoder returns a string instead of Bytes.
    await expect(decodeValue("plain-string" as unknown as Buffer, "json")).rejects.toThrow(
      ValkeyCacheTypeError,
    );
  });

  it("ValkeyCache protects against prototype pollution during deserialization", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const key = `test-${Math.random().toString(36).slice(2)}`;

    // Simulate malicious JSON payload in the cache
    const maliciousJson =
      '{"__proto__": {"polluted": true}, "constructor": {"prototype": {"polluted": true}, "tag": "safe"}, "normal": "value"}';
    const cacheKey = cache.getKey(key);
    await cacheValkeyClient.set(cacheKey, Buffer.from(maliciousJson, "utf8"));

    const result = await cache.get(key);
    expect(result).toBeDefined();

    // Ensure the resulting object is not polluted
    // @ts-expect-error - checking for non-existent polluted property
    expect(result.polluted).toBeUndefined();
    // @ts-expect-error - checking for __proto__ property
    expect(result.__proto__).not.toEqual({ polluted: true });
    const decoded = result as Record<string, unknown>;
    // @ts-expect-error - checking for constructor property
    expect((decoded.constructor as Record<string, unknown>).tag).toBe("safe");
    // @ts-expect-error - checking constructor.prototype
    expect((decoded.constructor as Record<string, unknown>).prototype).toBeUndefined();
    // Ensure normal values still load
    expect(decoded.normal).toBe("value");

    await cache.delete(key);
  });
});
