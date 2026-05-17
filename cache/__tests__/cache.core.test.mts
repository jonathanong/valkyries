import { ValkeyCache } from "../../cache.mts";
import { it, expect, describe } from "vitest";
import { cacheValkeyClient } from "../../clients.mts";
import { valkeyEvents } from "../../events.mts";

describe("cache.core", () => {
  async function waitFor(
    condition: () => boolean | Promise<boolean>,
    timeoutMs = 1000,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await condition()) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(`waitFor timed out after ${timeoutMs}ms`);
  }

  function waitForCacheSetSkipped(cacheName: string, key: string): Promise<void> {
    return new Promise((resolve) => {
      const handler = (data: { cacheName: string; keys: string[] }) => {
        if (data.cacheName !== cacheName || !data.keys.includes(key)) return;
        valkeyEvents.off("cache:set-skipped", handler);
        resolve();
      };
      valkeyEvents.on("cache:set-skipped", handler);
    });
  }

  it("ValkeyCache", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const key = `test-${Math.random().toString(36).slice(2)}`;
    const value = { test: "test" };
    await cache.set(key, value);
    expect(await cache.get(key)).toEqual(value);
    await cache.delete(key);
    expect(await cache.get(key)).toBeNull();
  });

  it("ValkeyCache.invalidate", async () => {
    const uniquePrefix = `test-invalidate-${Math.random().toString(36).slice(2)}`;
    const cache = new ValkeyCache({ prefix: uniquePrefix, ttlSeconds: 10 });
    const key = `test-${Math.random().toString(36).slice(2)}`;
    const value = { test: "test" };
    await cache.set(key, value);
    expect(await cache.get(key)).toEqual(value);
    await cache.invalidate();
    expect(await cache.get(key)).toBeNull();
  }, 15000);

  it("ValkeyCache compresses large values", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const key = `test-${Math.random().toString(36).slice(2)}`;
    // Create a value larger than 2KB to trigger compression
    const largeValue = { data: "x".repeat(3000) };
    await cache.set(key, largeValue);
    const result = await cache.get(key);
    expect(result).toEqual(largeValue);
    await cache.delete(key);
  });

  it("ValkeyCache handles null values with nullTtl", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 60, nullTtlSeconds: 5 });
    const key = `test-${Math.random().toString(36).slice(2)}`;

    // Set null value with explicit TTL (must be > 0)
    await cache.set(key, null, 5);

    // Should return null immediately
    const result = await cache.get(key);
    expect(result).toBeNull();

    await cache.delete(key);
  });

  it("ValkeyCache uses default nullTtl when not provided", () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 60 });
    // nullTtl should be ttlSeconds / 60 = 1
    expect(cache.nullTtl).toBe(1);
  });

  it("ValkeyCache cacheGetByAny caches result", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const key = `test-${Math.random().toString(36).slice(2)}`;
    let callCount = 0;

    const fetchFn = (id: string) => {
      callCount++;
      return Promise.resolve({ id, data: "test" });
    };

    const cachedFn = cache.cacheGetByAny(fetchFn);

    // First call should fetch
    const result1 = await cachedFn(key);
    expect(callCount).toBe(1);
    expect(result1).toEqual({ id: key, data: "test" });
    await waitFor(async () => (await cache.get(key)) !== null);

    // Second call should use cache
    const result2 = await cachedFn(key);
    expect(callCount).toBe(1); // Should not increment
    expect(result2).toEqual({ id: key, data: "test" });

    await cache.delete(key);
  });

  it("ValkeyCache cacheGetByAny skips stale miss write after invalidation", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const key = `test-stale-miss-${Math.random().toString(36).slice(2)}`;
    let releaseFetch!: (value: { id: string; version: number }) => void;
    const fetchValue = new Promise<{ id: string; version: number }>((resolveFetch) => {
      releaseFetch = resolveFetch;
    });
    let resultPromise: Promise<{ id: string; version: number } | null> | null = null;
    const fetchStarted = new Promise<void>((resolveStarted) => {
      const cachedFn = cache.cacheGetByAny((id: string) => {
        resolveStarted();
        return fetchValue.then((value) => ({ ...value, id }));
      });

      resultPromise = cachedFn(key);
    });

    await fetchStarted;
    await cache.delete(key);
    const skippedSet = waitForCacheSetSkipped(cache.prefix, key);
    releaseFetch({ id: key, version: 1 });
    if (!resultPromise) throw new Error("cache fetch did not start");
    await expect(resultPromise).resolves.toEqual({ id: key, version: 1 });
    await skippedSet;

    expect(await cache.get(key)).toBeNull();
  });

  it("ValkeyCache cacheGetByAny caches null values", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 600, nullTtlSeconds: 5 });
    const key = `test-${Math.random().toString(36).slice(2)}`;
    let callCount = 0;

    const fetchFn = (_id: string) => {
      callCount++;
      return Promise.resolve(null);
    };

    const cachedFn = cache.cacheGetByAny(fetchFn);

    // First call should fetch
    const result1 = await cachedFn(key);
    expect(callCount).toBe(1);
    expect(result1).toBeNull();

    // Wait for the null tombstone write to land
    await waitFor(async () => (await cacheValkeyClient.ttl(cache.getKey(key))) !== -2);

    // Second call should serve the cached null without re-fetching
    const result2 = await cachedFn(key);
    expect(callCount).toBe(1); // cache hit — no re-fetch
    expect(result2).toBeNull();

    await cache.delete(key);
  });

  it("ValkeyCache invalidateCacheGetByAny deletes keys", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const key1 = `test1-${Math.random().toString(36).slice(2)}`;
    const key2 = `test2-${Math.random().toString(36).slice(2)}`;

    await cache.set(key1, { data: "test1" });
    await cache.set(key2, { data: "test2" });

    expect(await cache.get(key1)).not.toBeNull();
    expect(await cache.get(key2)).not.toBeNull();

    await cache.invalidateCacheGetByAny(key1, key2);

    expect(await cache.get(key1)).toBeNull();
    expect(await cache.get(key2)).toBeNull();
  });

  it("ValkeyCache case-insensitive keys resolve to same cache entry", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const baseKey = `test-key-${Math.random().toString(36).slice(2)}`;
    const lowerKey = baseKey.toLowerCase();
    const upperKey = baseKey.toUpperCase();
    const mixedKey = baseKey.charAt(0).toUpperCase() + baseKey.slice(1).toLowerCase();
    const value = { data: "test-value" };

    // Set with lowercase key
    await cache.set(lowerKey, value);

    // Get with uppercase key - should return the same value
    const result1 = await cache.get(upperKey);
    expect(result1).toEqual(value);

    // Get with mixed case key - should return the same value
    const result2 = await cache.get(mixedKey);
    expect(result2).toEqual(value);

    // Get with lowercase key - should return the same value
    const result3 = await cache.get(lowerKey);
    expect(result3).toEqual(value);

    await cache.delete(lowerKey);
  });

  it("ValkeyCache case-insensitive invalidation works", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const baseKey = `test-key-${Math.random().toString(36).slice(2)}`;
    const lowerKey = baseKey.toLowerCase();
    const upperKey = baseKey.toUpperCase();
    const value = { data: "test-value" };

    // Set with lowercase key
    await cache.set(lowerKey, value);

    // Verify it's cached
    expect(await cache.get(lowerKey)).toEqual(value);
    expect(await cache.get(upperKey)).toEqual(value);

    // Invalidate with uppercase key
    await cache.delete(upperKey);

    // Both should be invalidated
    expect(await cache.get(lowerKey)).toBeNull();
    expect(await cache.get(upperKey)).toBeNull();
  });

  it("ValkeyCache getBatch deduplicates duplicate keys", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const id = `test-getbatch-dup-${Math.random().toString(36).slice(2)}`;
    await cache.set(id, { data: "value" });

    const result = await cache.getBatch([id, id, id]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ data: "value" });
    expect(result[1]).toEqual({ data: "value" });
    expect(result[2]).toEqual({ data: "value" });

    await cache.delete(id);
  });

  it("ValkeyCache cacheGetByAny serves cached null from no-expiry key", async () => {
    // Keys stored without a TTL have PTTL=-1. The keyExists check must treat -1 as
    // "key exists" so cached nulls are served without re-fetching the source.
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const key = `test-no-expiry-${Math.random().toString(36).slice(2)}`;
    let callCount = 0;
    const cachedFn = cache.cacheGetByAny((_id: string) => {
      callCount++;
      return Promise.resolve(null);
    });

    // Store null directly in Valkey with no expiry (PTTL will be -1)
    const cacheKey = cache.getKey(key);
    await cacheValkeyClient.set(cacheKey, Buffer.from("null"));

    const result = await cachedFn(key);
    expect(result).toBeNull();
    expect(callCount).toBe(0); // no re-fetch; cache hit

    await cache.delete(key);
  });

  it("ValkeyCache cacheGetByAnyBatch serves cached null from no-expiry key", async () => {
    // Same as cacheGetByAny: PTTL=-1 keys must be treated as cache hits.
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const key = `test-batch-no-expiry-${Math.random().toString(36).slice(2)}`;
    let callCount = 0;
    const cachedFn = cache.cacheGetByAnyBatch((ids: string[]) => {
      callCount += ids.length;
      return Promise.resolve(ids.map(() => null));
    });

    // Store null directly in Valkey with no expiry (PTTL will be -1)
    const cacheKey = cache.getKey(key);
    await cacheValkeyClient.set(cacheKey, Buffer.from("null"));

    const result = await cachedFn([key]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeNull();
    expect(callCount).toBe(0); // no re-fetch; cache hit

    await cache.delete(key);
  });
});
