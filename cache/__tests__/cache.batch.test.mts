import { ValkeyCache } from "../../cache.mts";
import { it, expect, describe } from "vitest";
import { cacheValkeyClient } from "../../clients.mts";

describe("cache.batch", () => {
  it("ValkeyCache cacheGetByAnyBatch returns empty array for empty input", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    let callCount = 0;

    const batchFn = (ids: string[]) => {
      callCount += ids.length;
      return Promise.resolve(ids.map((id) => ({ id, data: "test" })));
    };

    const cachedFn = cache.cacheGetByAnyBatch(batchFn);
    const result = await cachedFn([]);

    expect(result).toEqual([]);
    expect(callCount).toBe(0);
  });

  it("ValkeyCache cacheGetByAnyBatch deduplicates duplicate keys", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const id = `test-dup-${Math.random().toString(36).slice(2)}`;
    let batchCallIds: string[] = [];

    const batchFn = (ids: string[]) => {
      batchCallIds = [...ids];
      return Promise.resolve(ids.map((i) => ({ id: i, data: "test" })));
    };

    const cachedFn = cache.cacheGetByAnyBatch(batchFn);

    // Same key appears twice — should be fetched once, result shared at both positions
    const result = await cachedFn([id, id]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id, data: "test" });
    expect(result[1]).toEqual({ id, data: "test" });
    expect(batchCallIds).toEqual([id]); // batchFn only called once per unique key

    await cache.delete(id);
  });

  it("ValkeyCache cacheGetByAnyBatch case-insensitive keys resolve to same cache entry", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const baseKey = `test-key-${Math.random().toString(36).slice(2)}`;
    const lowerKey = baseKey.toLowerCase();
    const upperKey = baseKey.toUpperCase();
    let batchCallIds: string[] = [];

    const cachedFn = cache.cacheGetByAnyBatch((ids: string[]) => {
      batchCallIds.push(...ids);
      return Promise.resolve(ids.map((id) => ({ id, data: "test" })));
    });

    // Warm cache with lowercase
    const result1 = await cachedFn([lowerKey]);
    expect(result1[0]).toEqual({ id: lowerKey, data: "test" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Call with uppercase — should be a cache hit, not a new fetch
    batchCallIds = [];
    const result2 = await cachedFn([upperKey]);
    expect(result2[0]).toEqual({ id: lowerKey, data: "test" }); // value from cache (original id)
    expect(batchCallIds).toHaveLength(0); // no fetch triggered

    await cache.delete(lowerKey);
  });

  it("ValkeyCache cacheGetByAnyBatch returns null for empty-string keys and excludes them from batchFn", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const id = `test-empty-str-${Math.random().toString(36).slice(2)}`;
    let batchCallIds: string[] = [];

    const cachedFn = cache.cacheGetByAnyBatch((ids: string[]) => {
      batchCallIds = ids;
      return Promise.resolve(ids.map((i) => ({ id: i })));
    });

    const result = await cachedFn([id, "" as unknown as string, id]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ id });
    expect(result[1]).toBeNull(); // empty-string key → null
    expect(result[2]).toEqual({ id }); // duplicate of id1
    expect(batchCallIds).not.toContain(""); // empty-string key not forwarded to batchFn

    await cache.delete(id);
  });

  it("ValkeyCache cacheGetByAnyBatch preserves positions for null/undefined keys", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const id1 = `test-null-key1-${Math.random().toString(36).slice(2)}`;
    const id2 = `test-null-key2-${Math.random().toString(36).slice(2)}`;
    let batchCallIds: string[] = [];

    const batchFn = (ids: string[]) => {
      batchCallIds = ids;
      return Promise.resolve(ids.map((id) => ({ id, data: "test" })));
    };

    const cachedFn = cache.cacheGetByAnyBatch(batchFn);

    // null/undefined at position 1 should return null without being sent to batchFn
    const result = await cachedFn([id1, null as unknown as string, id2]);

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ id: id1, data: "test" });
    expect(result[1]).toBeNull(); // null key → null at original position
    expect(result[2]).toEqual({ id: id2, data: "test" });
    expect(batchCallIds).toEqual([id1, id2]); // only non-null keys sent to batchFn

    await cache.delete(id1, id2);
  });

  it("ValkeyCache cacheGetByAnyBatch fetches and caches all results", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const id1 = `opt-test1-${Math.random().toString(36).slice(2)}`;
    const id2 = `opt-test2-${Math.random().toString(36).slice(2)}`;
    const id3 = `opt-test3-${Math.random().toString(36).slice(2)}`;
    let batchCallCount = 0;
    let lastBatchIds: string[] = [];

    const batchFn = (ids: string[]) => {
      batchCallCount++;
      lastBatchIds = ids;
      return Promise.resolve(ids.map((id) => ({ id, data: `data-${id}` })));
    };

    const cachedFn = cache.cacheGetByAnyBatch(batchFn);

    // First call should fetch all via a single batch call
    const result1 = await cachedFn([id1, id2, id3]);
    expect(batchCallCount).toBe(1);
    expect(lastBatchIds).toEqual([id1, id2, id3]);
    expect(result1).toHaveLength(3);
    expect(result1[0]).toEqual({ id: id1, data: `data-${id1}` });
    expect(result1[1]).toEqual({ id: id2, data: `data-${id2}` });
    expect(result1[2]).toEqual({ id: id3, data: `data-${id3}` });

    // Wait for cache writes
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Second call should use cache
    batchCallCount = 0;
    const result2 = await cachedFn([id1, id2, id3]);
    expect(batchCallCount).toBe(0);
    expect(result2).toEqual(result1);

    await cache.delete(id1, id2, id3);
  });

  it("ValkeyCache cacheGetByAnyBatch fetches only missing IDs", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const id1 = `opt-miss1-${Math.random().toString(36).slice(2)}`;
    const id2 = `opt-miss2-${Math.random().toString(36).slice(2)}`;
    const id3 = `opt-miss3-${Math.random().toString(36).slice(2)}`;
    let lastBatchIds: string[] = [];

    const batchFn = (ids: string[]) => {
      lastBatchIds = ids;
      return Promise.resolve(ids.map((id) => ({ id, data: `data-${id}` })));
    };

    // Pre-cache id1 and id2
    await cache.set(id1, { id: id1, data: `data-${id1}` });
    await cache.set(id2, { id: id2, data: `data-${id2}` });

    const cachedFn = cache.cacheGetByAnyBatch(batchFn);
    const result = await cachedFn([id1, id2, id3]);

    // Should only batch-fetch id3
    expect(lastBatchIds).toEqual([id3]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ id: id1, data: `data-${id1}` });
    expect(result[1]).toEqual({ id: id2, data: `data-${id2}` });
    expect(result[2]).toEqual({ id: id3, data: `data-${id3}` });

    await cache.delete(id1, id2, id3);
  });

  it("ValkeyCache cacheGetByAnyBatch handles null values", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 600, nullTtlSeconds: 5 });
    const id1 = `opt-null1-${Math.random().toString(36).slice(2)}`;
    const id2 = `opt-null2-${Math.random().toString(36).slice(2)}`;
    let batchCallCount = 0;

    const batchFn = (ids: string[]) => {
      batchCallCount++;
      return Promise.resolve(ids.map((id) => (id === id1 ? null : { id, data: "test" })));
    };

    const cachedFn = cache.cacheGetByAnyBatch(batchFn);

    const result = await cachedFn([id1, id2]);
    expect(batchCallCount).toBe(1);
    expect(result[0]).toBeNull();
    expect(result[1]).toEqual({ id: id2, data: "test" });

    // Wait for cache writes
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Second call should use cache (including null)
    batchCallCount = 0;
    const result2 = await cachedFn([id1, id2]);
    expect(batchCallCount).toBe(0);
    expect(result2[0]).toBeNull();
    expect(result2[1]).toEqual({ id: id2, data: "test" });

    await cache.delete(id1, id2);
  });

  it("ValkeyCache cacheGetByAnyBatch maintains order of input IDs", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const ids = Array.from(
      { length: 5 },
      (_, i) => `opt-order-${i}-${Math.random().toString(36).slice(2)}`,
    );

    const batchFn = (batchIds: string[]) => {
      return Promise.resolve(batchIds.map((id) => ({ id, index: ids.indexOf(id) })));
    };

    const cachedFn = cache.cacheGetByAnyBatch(batchFn);
    const result = await cachedFn(ids);

    expect(result).toHaveLength(5);
    for (let i = 0; i < ids.length; i++) {
      expect(result[i]).toEqual({ id: ids[i], index: i });
    }

    await cache.delete(...ids);
  });

  it("ValkeyCache cacheGetByAnyBatch throws on mismatched batch result length", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const id1 = `opt-err1-${Math.random().toString(36).slice(2)}`;
    const id2 = `opt-err2-${Math.random().toString(36).slice(2)}`;

    const batchFn = (_ids: string[]) => {
      // Return wrong number of results
      return Promise.resolve([{ id: "only-one" }]);
    };

    const cachedFn = cache.cacheGetByAnyBatch(batchFn);
    await expect(cachedFn([id1, id2])).rejects.toThrow("Batch function returned invalid result");
  });

  it("ValkeyCache cacheGetByAnyBatch refreshes stale entries using batch function", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, staleTtlAge: 0.8 });
    const id1 = `opt-stale1-${Math.random().toString(36).slice(2)}`;
    const id2 = `opt-stale2-${Math.random().toString(36).slice(2)}`;
    let batchCallCount = 0;
    let version = 1;

    const batchFn = (ids: string[]) => {
      batchCallCount++;
      return Promise.resolve(ids.map((id) => ({ id, version: version++ })));
    };

    const cachedFn = cache.cacheGetByAnyBatch(batchFn);

    // Populate cache
    const result1 = await cachedFn([id1, id2]);
    expect(batchCallCount).toBe(1);
    expect(result1[0]).toMatchObject({ id: id1 });
    expect(result1[1]).toMatchObject({ id: id2 });

    // Wait for cache writes
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Expire both keys to within the stale refresh window (TTL < 2s)
    const cacheKey1 = cache.getKey(id1);
    const cacheKey2 = cache.getKey(id2);
    await cacheValkeyClient.expire(cacheKey1, 1);
    await cacheValkeyClient.expire(cacheKey2, 1);

    // Read again - should return stale values but trigger background batch refresh
    batchCallCount = 0;
    const result2 = await cachedFn([id1, id2]);
    // Returns stale cached values immediately
    expect(result2[0]).toMatchObject({ id: id1 });
    expect(result2[1]).toMatchObject({ id: id2 });

    // Wait for background batch refresh to complete
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(batchCallCount).toBe(1); // Single batch call for both stale entries

    // Verify cache was refreshed with new TTLs
    const ttl1 = await cacheValkeyClient.ttl(cacheKey1);
    const ttl2 = await cacheValkeyClient.ttl(cacheKey2);
    expect(ttl1).toBeGreaterThan(1);
    expect(ttl2).toBeGreaterThan(1);

    await cache.delete(id1, id2);
  });

  it("ValkeyCache cacheGetByAnyBatch does not refresh non-stale entries", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, staleTtlAge: 0.9 });
    const id1 = `opt-fresh1-${Math.random().toString(36).slice(2)}`;
    let batchCallCount = 0;

    const batchFn = (ids: string[]) => {
      batchCallCount++;
      return Promise.resolve(ids.map((id) => ({ id, data: "test" })));
    };

    const cachedFn = cache.cacheGetByAnyBatch(batchFn);

    // Populate cache
    await cachedFn([id1]);
    expect(batchCallCount).toBe(1);

    // Wait for cache writes
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Read again - entry is fresh (TTL ~10s, outside refresh window of 2s)
    batchCallCount = 0;
    await cachedFn([id1]);

    // Wait and verify no background refresh was triggered
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(batchCallCount).toBe(0);

    await cache.delete(id1);
  });

  it("ValkeyCache cacheGetByAnyBatch deduplicates concurrent stale refreshes", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, staleTtlAge: 0.8 });
    const id1 = `opt-dedup1-${Math.random().toString(36).slice(2)}`;
    let batchCallCount = 0;

    const batchFn = async (ids: string[]) => {
      batchCallCount++;
      // Simulate slow fetch
      await new Promise((resolve) => setTimeout(resolve, 100));
      return ids.map((id) => ({ id, data: "refreshed" }));
    };

    const cachedFn = cache.cacheGetByAnyBatch(batchFn);

    // Populate cache
    await cachedFn([id1]);
    expect(batchCallCount).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Make entry stale
    const cacheKey1 = cache.getKey(id1);
    await cacheValkeyClient.expire(cacheKey1, 1);

    // Call twice quickly - should only trigger one refresh
    batchCallCount = 0;
    await cachedFn([id1]);
    await cachedFn([id1]);

    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(batchCallCount).toBe(1); // Only one batch refresh call

    await cache.delete(id1);
  });

  it("ValkeyCache cacheGetByAnyBatch refreshes stale entries even when some are missing", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, staleTtlAge: 0.8 });
    const staleId = `opt-mix-stale-${Math.random().toString(36).slice(2)}`;
    const missingId = `opt-mix-miss-${Math.random().toString(36).slice(2)}`;
    const fetchedIds: string[][] = [];

    const batchFn = (ids: string[]) => {
      fetchedIds.push([...ids]);
      return Promise.resolve(ids.map((id) => ({ id, data: `data-${id}` })));
    };

    const cachedFn = cache.cacheGetByAnyBatch(batchFn);

    // Populate staleId in cache
    await cachedFn([staleId]);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Make staleId stale
    await cacheValkeyClient.expire(cache.getKey(staleId), 1);

    // Fetch both: staleId (cached but stale) + missingId (not cached)
    fetchedIds.length = 0;
    const result = await cachedFn([staleId, missingId]);

    expect(result[0]).toMatchObject({ id: staleId });
    expect(result[1]).toMatchObject({ id: missingId });

    // Wait for background stale refresh
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Two batch calls: one for missing IDs (foreground) and one for stale IDs (background)
    expect(fetchedIds).toHaveLength(2);
    const allFetchedIds = fetchedIds.flat();
    expect(allFetchedIds).toContain(missingId);
    expect(allFetchedIds).toContain(staleId);

    await cache.delete(staleId, missingId);
  });

  it("ValkeyCache cacheGetByAnyBatch background refresh caches null when batchFn returns undefined", async () => {
    // Verifies entity-deletion scenario: stale-refresh returning undefined is treated
    // as null (cached with nullTtl) rather than silently keeping the old object alive.
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, staleTtlAge: 0.8 });
    const key = `test-undef-refresh-${Math.random().toString(36).slice(2)}`;
    let version = 0;

    const cachedFn = cache.cacheGetByAnyBatch((ids: string[]) =>
      Promise.resolve(ids.map(() => (version === 0 ? { data: "original" } : undefined))),
    );

    // Populate cache with the original value
    const result1 = await cachedFn([key]);
    expect(result1[0]).toEqual({ data: "original" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Make the entry stale, then simulate entity deletion (version=1 → returns undefined)
    await cacheValkeyClient.expire(cache.getKey(key), 1);
    version = 1;

    // Second call: returns stale cached value, triggers background refresh
    await cachedFn([key]);

    // Wait for background refresh — undefined should be written as null
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await cache.get(key)).toBeNull();

    await cache.delete(key);
  });
});
