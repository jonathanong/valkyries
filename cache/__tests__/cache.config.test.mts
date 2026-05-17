import { ValkeyCache } from "../../cache.mts";
import { it, expect, describe } from "vitest";
import { valkeyEvents } from "../../events.mts";
import { cacheValkeyClient } from "../../clients.mts";

describe("cache.config", () => {
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
  it("ValkeyCache keySerializer is used to build cache key", async () => {
    type Key = { ns: string; id: string };
    const cache = new ValkeyCache<Key>({
      prefix: "test",
      ttlSeconds: 10,
      keySerializer: ({ ns, id }) => `${ns}:${id}`,
    });
    const key: Key = { ns: `ns-${Math.random().toString(36).slice(2)}`, id: "bar" };
    await cache.set(key, { data: "hello" });
    expect(await cache.get(key)).toEqual({ data: "hello" });
    await cache.delete(key);
  });

  it("ValkeyCache cacheGetByAny works with composite keys", async () => {
    type Key = { ns: string; id: string };
    const cache = new ValkeyCache<Key>({
      prefix: "test",
      ttlSeconds: 10,
      keySerializer: ({ ns, id }) => `${ns}:${id}`,
    });
    let callCount = 0;
    const cachedFn = cache.cacheGetByAny((key: Key) => {
      callCount++;
      return Promise.resolve({ ...key, data: "fetched" });
    });
    const key: Key = { ns: `ns-${Math.random().toString(36).slice(2)}`, id: "x" };
    const r1 = await cachedFn(key);
    expect(callCount).toBe(1);
    expect(r1).toEqual({ ...key, data: "fetched" });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const r2 = await cachedFn(key);
    expect(callCount).toBe(1); // cache hit
    expect(r2).toEqual(r1);
    await cache.delete(key);
  });

  it("ValkeyCache invalidateCacheGetByAny works with composite keys", async () => {
    type Key = { ns: string; id: string };
    const cache = new ValkeyCache<Key>({
      prefix: "test",
      ttlSeconds: 10,
      keySerializer: ({ ns, id }) => `${ns}:${id}`,
    });
    const key: Key = { ns: `ns-${Math.random().toString(36).slice(2)}`, id: "y" };
    await cache.set(key, { data: "stored" });
    expect(await cache.get(key)).toEqual({ data: "stored" });
    await cache.invalidateCacheGetByAny(key);
    expect(await cache.get(key)).toBeNull();
  });

  it("ValkeyCache string keys work without keySerializer (default behavior)", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const key = `string-key-${Math.random().toString(36).slice(2)}`;
    await cache.set(key, { ok: true });
    expect(await cache.get(key)).toEqual({ ok: true });
    await cache.delete(key);
  });

  it("ValkeyCache cacheGetByAnyBatch works with composite keys", async () => {
    type Key = { feed: string; item: string };
    const suffix = Math.random().toString(36).slice(2);
    const cache = new ValkeyCache<Key>({
      prefix: "test",
      ttlSeconds: 10,
      keySerializer: ({ feed, item }) => `${feed}:${item}`,
    });
    const keys: Key[] = [
      { feed: `f1-${suffix}`, item: "a" },
      { feed: `f2-${suffix}`, item: "b" },
    ];
    let batchCallCount = 0;

    const cachedFn = cache.cacheGetByAnyBatch((ks: Key[]) => {
      batchCallCount++;
      return Promise.resolve(ks.map((k) => ({ ...k, data: "fetched" })));
    });

    const r1 = await cachedFn(keys);
    expect(batchCallCount).toBe(1);
    expect(r1[0]).toEqual({ ...keys[0], data: "fetched" });
    expect(r1[1]).toEqual({ ...keys[1], data: "fetched" });

    await new Promise((resolve) => setTimeout(resolve, 50));
    batchCallCount = 0;
    const r2 = await cachedFn(keys);
    expect(batchCallCount).toBe(0);
    expect(r2).toEqual(r1);

    await cache.delete(...keys);
  });

  it("ValkeyCache refreshById works with composite keys", async () => {
    type Key = { feed: string; item: string };
    const suffix = Math.random().toString(36).slice(2);
    const cache = new ValkeyCache<Key>({
      prefix: "test",
      ttlSeconds: 10,
      keySerializer: ({ feed, item }) => `${feed}:${item}`,
    });
    const primary: Key = { feed: `f-${suffix}`, item: "primary" };
    const alias: Key = { feed: `f-${suffix}`, item: "alias" };
    let callCount = 0;

    const result = await cache.refreshById([primary, alias], (key: Key) => {
      callCount++;
      return Promise.resolve({ ...key, fresh: true });
    });

    expect(callCount).toBe(1);
    expect(result).toEqual({ ...primary, fresh: true });

    // refreshById writes to Valkey in the background, so wait for the cache write to land.
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(await cache.get(primary)).toEqual({ ...primary, fresh: true });
    expect(await cache.get(alias)).toEqual({ ...primary, fresh: true });

    await cache.delete(primary, alias);
  });

  it("ValkeyCache cacheGetByAnyBatch fetches only missing composite keys", async () => {
    type Key = { ns: string; id: string };
    const suffix = Math.random().toString(36).slice(2);
    const cache = new ValkeyCache<Key>({
      prefix: "test",
      ttlSeconds: 10,
      keySerializer: ({ ns, id }) => `${ns}:${id}`,
    });
    const k1: Key = { ns: `ns-${suffix}`, id: "1" };
    const k2: Key = { ns: `ns-${suffix}`, id: "2" };
    const k3: Key = { ns: `ns-${suffix}`, id: "3" };
    let lastBatchKeys: Key[] = [];

    await cache.set(k1, { id: "1" });
    await cache.set(k2, { id: "2" });

    const cachedFn = cache.cacheGetByAnyBatch((ks: Key[]) => {
      lastBatchKeys = ks;
      return Promise.resolve(ks.map((k) => ({ id: k.id })));
    });

    const result = await cachedFn([k1, k2, k3]);
    expect(lastBatchKeys).toEqual([k3]);
    expect(result[0]).toEqual({ id: "1" });
    expect(result[1]).toEqual({ id: "2" });
    expect(result[2]).toEqual({ id: "3" });

    await cache.delete(k1, k2, k3);
  });

  it("ValkeyCache cacheGetByAnyBatch skips stale miss writes after invalidation", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const key = `test-batch-stale-miss-${Math.random().toString(36).slice(2)}`;
    let releaseFetch!: (values: Array<{ id: string; version: number }>) => void;
    const fetchValues = new Promise<Array<{ id: string; version: number }>>((resolveFetch) => {
      releaseFetch = resolveFetch;
    });
    let resultPromise: Promise<Array<{ id: string; version: number } | null>> | null = null;
    const fetchStarted = new Promise<void>((resolveStarted) => {
      const cachedFn = cache.cacheGetByAnyBatch((ids: string[]) => {
        resolveStarted();
        return fetchValues.then((values) =>
          values.map((value, index) => ({ ...value, id: ids[index] })),
        );
      });

      resultPromise = cachedFn([key]);
    });

    await fetchStarted;
    await cache.delete(key);
    const skippedSet = waitForCacheSetSkipped(cache.prefix, key);
    releaseFetch([{ id: key, version: 1 }]);
    if (!resultPromise) throw new Error("cache batch fetch did not start");
    await expect(resultPromise).resolves.toEqual([{ id: key, version: 1 }]);
    await skippedSet;

    expect(await cache.get(key)).toBeNull();
  });

  it("ValkeyCache cacheGetByAny returns null when keySerializer returns whitespace-only string", async () => {
    const cache = new ValkeyCache({
      prefix: "test",
      ttlSeconds: 10,
      keySerializer: () => "   ",
    });
    let callCount = 0;
    const cachedFn = cache.cacheGetByAny((_id: string) => {
      callCount++;
      return Promise.resolve({ data: "value" });
    });

    expect(await cachedFn("anything")).toBeNull();
    expect(callCount).toBe(0);
  });

  it("ValkeyCache getKey throws for invalid keys", () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    expect(() => cache.getKey("" as unknown as string)).toThrow("ValkeyCache: invalid key");
    expect(() => cache.getKey(" " as unknown as string)).toThrow("ValkeyCache: invalid key");
    expect(() => cache.getKey(null as unknown as string)).toThrow("ValkeyCache: invalid key");
  });

  it("ValkeyCache get returns null for invalid keys without a lookup", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    for (const key of [null, undefined, "", " ", "\t"]) {
      expect(await cache.get(key as unknown as string)).toBeNull();
    }
  });

  it("ValkeyCache set is a no-op for invalid keys", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    // Should not throw and should not write anything
    await cache.set("" as unknown as string, { data: "value" });
    await cache.set(" " as unknown as string, { data: "value" });
    await cache.set(null as unknown as string, { data: "value" });
    // Verify no spurious cache:{} entry was created
    expect(await cache.get("" as unknown as string)).toBeNull();
  });

  it("ValkeyCache setBatch respects explicit ttl and ignores ttl: 0", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 600 });
    const k1 = `test-ttl-explicit-${Math.random().toString(36).slice(2)}`;
    const k2 = `test-ttl-zero-${Math.random().toString(36).slice(2)}`;

    await cache.setBatch([
      { key: k1, value: { ok: true }, ttl: 5 },
      { key: k2, value: { ok: true }, ttl: 0 }, // 0 is invalid — should fall back to this.ttl
    ]);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const cacheKey1 = cache.getKey(k1);
    const cacheKey2 = cache.getKey(k2);
    const [ttl1, ttl2] = await Promise.all([
      cacheValkeyClient.ttl(cacheKey1),
      cacheValkeyClient.ttl(cacheKey2),
    ]);

    expect(ttl1).toBeLessThanOrEqual(5);
    expect(ttl1).toBeGreaterThan(0);
    // ttl: 0 falls back to this.ttl (600s)
    expect(ttl2).toBeGreaterThan(5);

    await cache.delete(k1, k2);
  });

  it("ValkeyCache setBatch skips invalid-key entries and writes valid ones", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const key = `test-setbatch-invalid-${Math.random().toString(36).slice(2)}`;

    await cache.setBatch([
      { key: "" as unknown as string, value: { bad: true } },
      { key: " " as unknown as string, value: { bad: true } },
      { key, value: { ok: true } },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await cache.get("" as unknown as string)).toBeNull();
    expect(await cache.get(key)).toEqual({ ok: true });

    await cache.delete(key);
  });

  it("ValkeyCache delete ignores empty-string keys", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const key = `test-del-empty-${Math.random().toString(36).slice(2)}`;
    await cache.set(key, { data: "value" });
    expect(await cache.get(key)).not.toBeNull();

    // delete with an empty-string key mixed in should not throw and should still delete the valid key
    await cache.delete("" as unknown as string, key);
    expect(await cache.get(key)).toBeNull();
  });

  it("ValkeyCache cacheGetByAny returns null for empty-string key without fetching", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    let callCount = 0;
    const cachedFn = cache.cacheGetByAny((_id: string) => {
      callCount++;
      return Promise.resolve({ data: "value" });
    });

    const result = await cachedFn("");
    expect(result).toBeNull();
    expect(callCount).toBe(0); // fetch function must not be called for empty-string keys
  });

  it("ValkeyCache cacheGetByAny returns null for whitespace-only key without fetching", async () => {
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    let callCount = 0;
    const cachedFn = cache.cacheGetByAny((_id: string) => {
      callCount++;
      return Promise.resolve({ data: "value" });
    });

    for (const key of [" ", "\t", "  \n  "]) {
      const result = await cachedFn(key as unknown as string);
      expect(result).toBeNull();
    }
    expect(callCount).toBe(0);
  });

  it("ValkeyCache refreshById skips empty-string keys", async () => {
    // filter(k => k != null && k !== '') prevents fetchByKey('') being called,
    // which would store a wrong result under the valid key.
    const cache = new ValkeyCache({ prefix: "test", ttlSeconds: 10 });
    const id = `refresh-empty-${Math.random().toString(36).slice(2)}`;
    const fetchedKeys: string[] = [];

    const result = await cache.refreshById(["", id, ""], (key: string) => {
      fetchedKeys.push(key);
      return Promise.resolve({ id });
    });

    expect(result).toEqual({ id });
    expect(fetchedKeys).toEqual([id]); // only the non-empty key was fetched
    await cache.delete(id);
  });
});
