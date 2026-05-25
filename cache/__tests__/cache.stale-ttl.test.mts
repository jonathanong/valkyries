import { ValkeyCache } from "../../cache.mts";
import { it, expect, describe } from "vitest";
import { cacheValkeyClient } from "../../clients.mts";
import { valkeyEvents } from "../../events.mts";

describe("cache.stale-ttl", () => {
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

  it("ValkeyCache default staleTtlAge is 0.9", () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    expect(cache.staleTtlAge).toBe(0.9);
  });

  it("ValkeyCache staleTtlAge must be between 0 and 1", () => {
    expect(() => new ValkeyCache({ prefix: "test", ttlSeconds: 10, staleTtlAge: -0.1 })).toThrow(
      "ValkeyCache: staleTtlAge must be between 0 and 1",
    );
    expect(() => new ValkeyCache({ prefix: "test", ttlSeconds: 10, staleTtlAge: 1.1 })).toThrow(
      "ValkeyCache: staleTtlAge must be between 0 and 1",
    );
    expect(
      () => new ValkeyCache({ prefix: "test", ttlSeconds: 10, staleTtlAge: Number.NaN }),
    ).toThrow("ValkeyCache: staleTtlAge must be between 0 and 1");
  });

  it("ValkeyCache cacheGetByAny refreshes stale entries in the background", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, staleTtlAge: 0.8 });
    const key = `test-${Math.random().toString(36).slice(2)}`;
    let callCount = 0;
    const cachedFn = cache.cacheGetByAny((id: string) => {
      callCount++;
      return Promise.resolve({ id, version: callCount });
    });

    const result1 = await cachedFn(key);
    expect(callCount).toBe(1);
    expect(result1).toEqual({ id: key, version: 1 });

    // Wait for fire-and-forget cache write to land before we manipulate the TTL
    await waitFor(async () => (await cache.get(key)) !== null);

    const cacheKey = cache.getKey(key);
    await cacheValkeyClient.expire(cacheKey, 1); // 1s < refresh window of 2s → stale

    const result2 = await cachedFn(key);
    expect(result2).toEqual({ id: key, version: 1 });

    // Wait for background fetch and fire-and-forget write to both complete
    await waitFor(
      async () => ((await cache.get(key)) as { version: number } | null)?.version === 2,
    );
    expect(callCount).toBe(2);

    const refreshedValue = await cache.get(key);
    expect(refreshedValue).toEqual({ id: key, version: 2 });

    const ttlAfterRefresh = await cacheValkeyClient.ttl(cacheKey);
    expect(ttlAfterRefresh).toBeGreaterThan(1);

    await cache.delete(key);
  });

  it("ValkeyCache cacheGetByAny skips stale background refresh write after invalidation", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, staleTtlAge: 0.8 });
    const key = `test-stale-refresh-invalidated-${Math.random().toString(36).slice(2)}`;
    let releaseFetch!: (value: { id: string; version: number }) => void;
    const fetchValue = new Promise<{ id: string; version: number }>((resolveFetch) => {
      releaseFetch = resolveFetch;
    });
    let fetchCalls = 0;
    let resolveFetchStarted: (() => void) | null = null;
    const fetchStarted = new Promise<void>((resolve) => {
      resolveFetchStarted = resolve;
    });
    const cachedFn = cache.cacheGetByAny((id: string) => {
      fetchCalls++;
      if (fetchCalls === 1) return Promise.resolve({ id, version: 1 });

      resolveFetchStarted?.();
      return fetchValue.then((value) => ({ ...value, id }));
    });

    await cachedFn(key);
    await waitFor(async () => (await cache.get(key)) !== null);
    await cacheValkeyClient.expire(cache.getKey(key), 1);
    await cachedFn(key);
    await fetchStarted;
    await cache.delete(key);
    const skippedSet = waitForCacheSetSkipped(cache.prefix, key);
    releaseFetch({ id: key, version: 2 });
    await waitFor(() => fetchCalls === 2);
    await skippedSet;

    expect(await cache.get(key)).toBeNull();
  });

  it("ValkeyCache cacheGetByAnyBatch skips stale background refresh write after invalidation", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, staleTtlAge: 0.8 });
    const key = `test-batch-stale-refresh-invalidated-${Math.random().toString(36).slice(2)}`;
    let releaseFetch!: (values: Array<{ id: string; version: number }>) => void;
    const fetchValues = new Promise<Array<{ id: string; version: number }>>((resolveFetch) => {
      releaseFetch = resolveFetch;
    });
    let fetchCalls = 0;
    let resolveFetchStarted: (() => void) | null = null;
    const fetchStarted = new Promise<void>((resolve) => {
      resolveFetchStarted = resolve;
    });
    const cachedFn = cache.cacheGetByAnyBatch((ids: string[]) => {
      fetchCalls++;
      if (fetchCalls === 1) return Promise.resolve(ids.map((id) => ({ id, version: 1 })));

      resolveFetchStarted?.();
      return fetchValues.then((values) =>
        values.map((value, index) => ({ ...value, id: ids[index] })),
      );
    });

    await cachedFn([key]);
    await waitFor(async () => (await cache.get(key)) !== null);
    await cacheValkeyClient.expire(cache.getKey(key), 1);
    await cachedFn([key]);
    await fetchStarted;
    await cache.delete(key);
    const skippedSet = waitForCacheSetSkipped(cache.prefix, key);
    releaseFetch([{ id: key, version: 2 }]);
    await waitFor(() => fetchCalls === 2);
    await skippedSet;

    expect(await cache.get(key)).toBeNull();
  });

  it("ValkeyCache cacheGetByAny case-insensitive keys resolve to same cache", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const baseKey = `test-key-${Math.random().toString(36).slice(2)}`;
    const lowerKey = baseKey.toLowerCase();
    const upperKey = baseKey.toUpperCase();
    let callCount = 0;

    const fetchFn = (id: string) => {
      callCount++;
      return Promise.resolve({ id, data: "test" });
    };

    const cachedFn = cache.cacheGetByAny(fetchFn);

    // First call with lowercase
    const result1 = await cachedFn(lowerKey);
    expect(callCount).toBe(1);
    expect(result1).toEqual({ id: lowerKey, data: "test" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Second call with uppercase - should use cache, not call fetchFn again
    const result2 = await cachedFn(upperKey);
    expect(callCount).toBe(1); // Should not increment
    expect(result2).toEqual({ id: lowerKey, data: "test" }); // Returns original id from cache

    // Third call with lowercase - should use cache
    const result3 = await cachedFn(lowerKey);
    expect(callCount).toBe(1); // Should not increment
    expect(result3).toEqual({ id: lowerKey, data: "test" });

    await cache.delete(lowerKey);
  });

  it("ValkeyCache invalidateCacheGetByAny case-insensitive invalidation works", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const baseKey = `test-key-${Math.random().toString(36).slice(2)}`;
    const lowerKey = baseKey.toLowerCase();
    const upperKey = baseKey.toUpperCase();
    let callCount = 0;

    const fetchFn = (id: string) => {
      callCount++;
      return Promise.resolve({ id, data: "test" });
    };

    const cachedFn = cache.cacheGetByAny(fetchFn);

    // Cache with lowercase
    await cachedFn(lowerKey);
    expect(callCount).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Verify cached
    const cached1 = await cache.get(lowerKey);
    expect(cached1).not.toBeNull();

    // Invalidate with uppercase
    await cache.invalidateCacheGetByAny(upperKey);

    // Should be invalidated
    const cached2 = await cache.get(lowerKey);
    expect(cached2).toBeNull();

    // Next call should fetch again
    await cachedFn(lowerKey);
    expect(callCount).toBe(2);
  });

  it("ValkeyCache refreshById fetches once and updates all keys", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const id = `refresh-id-${Math.random().toString(36).slice(2)}`;
    const slug = `refresh-slug-${Math.random().toString(36).slice(2)}`;
    const upperSlug = slug.toUpperCase();
    let callCount = 0;

    const fetchById = (entityId: string) => {
      callCount++;
      return Promise.resolve({ id: entityId, value: "fresh" });
    };

    const result = await cache.refreshById([id, slug, upperSlug], fetchById);
    expect(callCount).toBe(1);
    expect(result).toEqual({ id, value: "fresh" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await cache.get(id)).toEqual({ id, value: "fresh" });
    expect(await cache.get(slug)).toEqual({ id, value: "fresh" });
    expect(await cache.get(upperSlug)).toEqual({ id, value: "fresh" });

    await cache.delete(id, slug, upperSlug);
  });

  it("collectRefreshAliases produces the same first-valid alias and dedupe output across threshold boundary", () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const collectRefreshAliases = (
      cache as unknown as {
        collectRefreshAliases: (aliases: string[]) => {
          firstValidAlias: string | null;
          serializedKeys: string[];
        };
      }
    ).collectRefreshAliases;

    const shortAliases = [
      "",
      " ",
      "primary",
      "PRIMARY",
      "alpha",
      "ALPHA",
      "",
      "beta",
      "  beta  ",
      "gamma",
      "",
      "GAMMA",
      "delta",
      "\t",
      "DELTA",
    ];
    const longAliases = [...shortAliases, "", "primary", "alpha", "beta"];

    const shortState = collectRefreshAliases.call(cache, shortAliases);
    const longState = collectRefreshAliases.call(cache, longAliases);

    expect(shortState.firstValidAlias).toBe("primary");
    expect(longState.firstValidAlias).toBe("primary");
    expect(longState.serializedKeys).toEqual(shortState.serializedKeys);
    expect(shortState.serializedKeys).toEqual(["primary", "alpha", "beta", "gamma", "delta"]);
  });

  it("ValkeyCache refreshById caches null using nullTtl", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 600, nullTtlSeconds: 5 });
    const id = `refresh-null-id-${Math.random().toString(36).slice(2)}`;
    const slug = `refresh-null-slug-${Math.random().toString(36).slice(2)}`;
    let callCount = 0;

    const result = await cache.refreshById([id, slug], () => {
      callCount++;
      return Promise.resolve(null);
    });

    expect(callCount).toBe(1);
    expect(result).toBeNull();
    expect(await cache.get(id)).toBeNull();
    expect(await cache.get(slug)).toBeNull();

    await cache.delete(id, slug);
  });

  it("ValkeyCache refreshById waits for the cache write before returning", async () => {
    // refreshById now waits for the Valkey write to finish, then returns the source value.
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const key = `refresh-ff-${Math.random().toString(36).slice(2)}`;
    const result = await cache.refreshById([key], () => Promise.resolve({ data: "value" }));
    expect(result).toEqual({ data: "value" });
    expect(await cache.get(key)).toEqual({ data: "value" });
    await cache.delete(key);
  });

  it("ValkeyCache cacheGetByAny background refresh caches null when fetchFn returns undefined", async () => {
    // Verifies entity-deletion scenario: stale-refresh returning undefined is treated
    // as null (cached with nullTtl) rather than silently keeping the old object alive.
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, staleTtlAge: 0.8 });
    const key = `test-undef-single-${Math.random().toString(36).slice(2)}`;
    let version = 0;

    const cachedFn = cache.cacheGetByAny((_id: string) =>
      Promise.resolve(version === 0 ? { data: "original" } : undefined),
    );

    // Populate cache with the original value
    expect(await cachedFn(key)).toEqual({ data: "original" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Make the entry stale, then simulate entity deletion (version=1 → returns undefined)
    await cacheValkeyClient.expire(cache.getKey(key), 1);
    version = 1;

    // Second call: returns stale cached value, triggers background refresh
    await cachedFn(key);

    // Wait for background refresh — undefined should be written as null
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await cache.get(key)).toBeNull();

    await cache.delete(key);
  });

  it("ValkeyCache cacheGetByAnyBatch does not background-refresh stale null entries", async () => {
    const cache = new ValkeyCache({
      prefix: "test",
      ttlSeconds: 10,
      nullTtlSeconds: 5,
      staleTtlAge: 0.8, // refresh window = (1 - 0.8) * 10s = 2s
    });
    const key = `test-null-stale-${Math.random().toString(36).slice(2)}`;
    let batchCallCount = 0;

    const batchFn = (ids: string[]) => {
      batchCallCount++;
      return Promise.resolve(ids.map(() => null));
    };

    const cachedFn = cache.cacheGetByAnyBatch(batchFn);

    // First call — fetches and caches null
    const result1 = await cachedFn([key]);
    expect(batchCallCount).toBe(1);
    expect(result1[0]).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 50));

    // Make the null entry stale (within staleTtlAge window)
    const cacheKey = cache.getKey(key);
    await cacheValkeyClient.expire(cacheKey, 1); // 1s remaining ≤ 1s threshold

    // Second call — stale null served from cache, no background refresh triggered
    batchCallCount = 0;
    const result2 = await cachedFn([key]);
    expect(result2[0]).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(batchCallCount).toBe(0); // null entries are never proactively refreshed

    await cache.delete(key);
  });
});
