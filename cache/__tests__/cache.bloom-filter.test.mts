import { ValkeyCache } from "../../cache.mts";
import { ValkeyBloomFilter } from "../../bloom-filter.mts";
import { it, expect, describe } from "vitest";

describe("cache.bloom-filter", () => {
  it("ValkeyCache bloom filter miss returns null without calling fetch fn", async () => {
    const filterName = `test-bf-miss-${Math.random().toString(36).slice(2)}`;
    const bloomFilter = new ValkeyBloomFilter({ name: filterName, capacity: 100, errorRate: 0.01 });
    await bloomFilter.ensureExists();

    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, bloomFilter });
    const key = `missing-entity-${Math.random().toString(36).slice(2)}`;

    let fetchCalled = false;
    const fn = cache.cacheGetByAny((_k: string) => {
      fetchCalled = true;
      return Promise.resolve({ id: _k });
    });

    // Key is not in bloom filter, so it's a definite miss — fetch fn should not be called
    const result = await fn(key);
    expect(result).toBeNull();
    expect(fetchCalled).toBe(false);

    await bloomFilter.delete();
  });

  it("ValkeyCache bloom filter hit proceeds to normal cache flow", async () => {
    const filterName = `test-bf-hit-${Math.random().toString(36).slice(2)}`;
    const bloomFilter = new ValkeyBloomFilter({ name: filterName, capacity: 100, errorRate: 0.01 });
    await bloomFilter.ensureExists();

    const key = `existing-entity-${Math.random().toString(36).slice(2)}`;
    await bloomFilter.add([key]);

    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, bloomFilter });
    const expected = { id: key };

    let fetchCalled = false;
    const fn = cache.cacheGetByAny((_k: string) => {
      fetchCalled = true;
      return Promise.resolve(expected);
    });

    // Key is in bloom filter (maybe), so fetch fn should be called
    const result = await fn(key);
    expect(fetchCalled).toBe(true);
    expect(result).toEqual(expected);

    await cache.delete(key);
    await bloomFilter.delete();
  });

  it("ValkeyCache batch bloom filter — misses skip fetch, hits proceed", async () => {
    const filterName = `test-bf-batch-${Math.random().toString(36).slice(2)}`;
    const bloomFilter = new ValkeyBloomFilter({ name: filterName, capacity: 100, errorRate: 0.01 });
    await bloomFilter.ensureExists();

    const hitKey = `bf-hit-${Math.random().toString(36).slice(2)}`;
    const missKey = `bf-miss-${Math.random().toString(36).slice(2)}`;
    await bloomFilter.add([hitKey]);

    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, bloomFilter });
    const expected = { id: hitKey };

    const fetchedKeys: string[] = [];
    const fn = cache.cacheGetByAnyBatch((keys: string[]) => {
      fetchedKeys.push(...keys);
      return Promise.resolve(keys.map((k) => (k === hitKey ? expected : null)));
    });

    const results = await fn([hitKey, missKey]);
    // hitKey was in filter and should have been fetched
    expect(fetchedKeys).toContain(hitKey);
    // missKey was not in filter and should NOT have been fetched
    expect(fetchedKeys).not.toContain(missKey);
    expect(results[0]).toEqual(expected);
    expect(results[1]).toBeNull();

    await cache.delete(hitKey);
    await bloomFilter.delete();
  });

  it("ValkeyCache getBatch bloom miss returns null even when value exists in Redis", async () => {
    // Verifies the batch Lua script checks the bloom filter BEFORE calling MGET:
    // a miss key with a real Redis value must return null, not the stored value.
    const filterName = `test-bf-getbatch-lua-${Math.random().toString(36).slice(2)}`;
    const bloomFilter = new ValkeyBloomFilter({ name: filterName, capacity: 100, errorRate: 0.01 });
    await bloomFilter.ensureExists();

    const hitKey = `bf-lua-hit-${Math.random().toString(36).slice(2)}`;
    const missKey = `bf-lua-miss-${Math.random().toString(36).slice(2)}`;
    await bloomFilter.add([hitKey]); // missKey intentionally NOT added

    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, bloomFilter });
    // Write values for BOTH keys — if MGET ran unconditionally, missKey would return a value
    await cache.set(hitKey, { id: hitKey });
    await cache.set(missKey, { id: missKey });

    const results = await cache.getBatch([hitKey, missKey]);
    expect(results[0]).toEqual({ id: hitKey }); // bloom hit → cached value returned
    expect(results[1]).toBeNull(); // bloom miss → null even though Redis has a value

    await cache.delete(hitKey, missKey);
    await bloomFilter.delete();
  });

  it("ValkeyCache batch bloom filter: all keys are bloom misses (all return null)", async () => {
    const filterName = `test-bf-batch-all-miss-${Math.random().toString(36).slice(2)}`;
    const bloomFilter = new ValkeyBloomFilter({ name: filterName, capacity: 100, errorRate: 0.01 });
    await bloomFilter.ensureExists();

    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, bloomFilter });
    const keys = [
      `miss-a-${Math.random().toString(36).slice(2)}`,
      `miss-b-${Math.random().toString(36).slice(2)}`,
    ];

    // Write values for both keys — bloom filter should prevent them from being returned
    await cache.set(keys[0]!, { id: keys[0] });
    await cache.set(keys[1]!, { id: keys[1] });

    const results = await cache.getBatch(keys);
    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();

    await cache.delete(...keys);
    await bloomFilter.delete();
  });

  it("ValkeyCache batch bloom filter: mixed bloom hits/misses", async () => {
    const filterName = `test-bf-batch-mixed-${Math.random().toString(36).slice(2)}`;
    const bloomFilter = new ValkeyBloomFilter({ name: filterName, capacity: 100, errorRate: 0.01 });
    await bloomFilter.ensureExists();

    const hitKey = `bf-mixed-hit-${Math.random().toString(36).slice(2)}`;
    const missKey = `bf-mixed-miss-${Math.random().toString(36).slice(2)}`;
    await bloomFilter.add([hitKey]);

    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, bloomFilter });
    await cache.set(hitKey, { id: hitKey });
    await cache.set(missKey, { id: missKey });

    const results = await cache.getBatch([hitKey, missKey]);
    expect(results[0]).toEqual({ id: hitKey }); // bloom hit → cached value
    expect(results[1]).toBeNull(); // bloom miss → null

    await cache.delete(hitKey, missKey);
    await bloomFilter.delete();
  });

  it("ValkeyCache batch bloom filter: bloom filter key does not exist (normal MGET path)", async () => {
    // When the bloom filter key doesn't exist in Valkey (never reserved), getBatch
    // falls back to the normal MGET path and returns cached values.
    const filterName = `test-bf-batch-nokey-${Math.random().toString(36).slice(2)}`;
    const bloomFilter = new ValkeyBloomFilter({ name: filterName, capacity: 100, errorRate: 0.01 });
    // Intentionally NOT calling ensureExists() — filter key does not exist

    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10, bloomFilter });
    const key = `bf-nokey-${Math.random().toString(36).slice(2)}`;
    await cache.set(key, { id: key });

    const results = await cache.getBatch([key]);
    // When bloom filter key doesn't exist, Lua script returns null for bloom results,
    // which means the cache treats it as "bloom check inconclusive" → returns cached value
    expect(results[0]).toEqual({ id: key });

    await cache.delete(key);
    await bloomFilter.delete();
  });

  it("ValkeyCache bloomFilterEnabled=false bypasses bloom filter", async () => {
    const filterName = `test-bf-disabled-${Math.random().toString(36).slice(2)}`;
    const bloomFilter = new ValkeyBloomFilter({ name: filterName, capacity: 100, errorRate: 0.01 });
    await bloomFilter.ensureExists();

    // bloomFilterEnabled always returns false — bloom filter is bypassed
    const cache = new ValkeyCache({
      prefix: "test",
      ttlSeconds: 10,
      bloomFilter,
      bloomFilterEnabled: () => false,
    });
    const key = `bf-disabled-${Math.random().toString(36).slice(2)}`;
    const expected = { id: key };

    let fetchCalled = false;
    const fn = cache.cacheGetByAny((_k: string) => {
      fetchCalled = true;
      return Promise.resolve(expected);
    });

    // Even though key is NOT in bloom filter, fetch should still be called because feature flag is off
    const result = await fn(key);
    expect(fetchCalled).toBe(true);
    expect(result).toEqual(expected);

    await cache.delete(key);
    await bloomFilter.delete();
  });
});
