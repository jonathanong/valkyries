import { ValkeyCache } from "../../cache.mts";
import { it, expect, describe } from "vitest";
import { valkeyEvents } from "../../events.mts";

describe("cache.events", () => {
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

  it("ValkeyCache emits cache:hit event via cacheGetByAny", async () => {
    const cache = new ValkeyCache({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });
    const key = `test-key-${Math.random().toString(36).slice(2)}`;

    // Set initial value
    await cache.set(key, { data: "test" });

    // Listen for cache:hit event
    const cacheName = cache.prefix;
    const hitEvents: { cacheName: string; keys: string[]; count: number }[] = [];
    const handler = (data: { cacheName: string; keys: string[]; count: number }) => {
      if (data.cacheName === cacheName) hitEvents.push(data);
    };
    valkeyEvents.on("cache:hit", handler);

    // Use cacheGetByAny to fetch (should trigger hit)
    const fn = cache.cacheGetByAny(() => Promise.resolve(null));
    try {
      const result = await fn(key);
      expect(result).toEqual({ data: "test" });
      expect(hitEvents).toHaveLength(1);
      expect(hitEvents[0]!.cacheName).toBe(cacheName);
      expect(hitEvents[0]!.count).toBe(1);
    } finally {
      valkeyEvents.off("cache:hit", handler);
      await cache.delete(key);
    }
  });

  it("ValkeyCache emits cache:miss event via cacheGetByAny", async () => {
    const cache = new ValkeyCache({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });
    const key = `test-miss-key-${Math.random().toString(36).slice(2)}`;

    const cacheName = cache.prefix;
    const missEvents: { cacheName: string; keys: string[]; count: number }[] = [];
    const handler = (data: { cacheName: string; keys: string[]; count: number }) => {
      if (data.cacheName === cacheName) missEvents.push(data);
    };
    valkeyEvents.on("cache:miss", handler);

    // Use cacheGetByAny to fetch non-existent key (should trigger miss)
    const fn = cache.cacheGetByAny(() => Promise.resolve({ fetched: "value" }));
    try {
      const result = await fn(key);
      expect(result).toEqual({ fetched: "value" });
      expect(missEvents).toHaveLength(1);
      expect(missEvents[0]!.cacheName).toBe(cacheName);
      expect(missEvents[0]!.count).toBe(1);
    } finally {
      valkeyEvents.off("cache:miss", handler);
      await cache.delete(key);
    }
  });

  it("ValkeyCache emits cache:set event via set()", async () => {
    const cache = new ValkeyCache({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });
    const key = `test-set-key-${Math.random().toString(36).slice(2)}`;
    const cacheName = cache.prefix;

    const setEvents: { cacheName: string; keys: string[] }[] = [];
    const handler = (data: { cacheName: string; keys: string[] }) => {
      if (data.cacheName === cacheName) setEvents.push(data);
    };
    valkeyEvents.on("cache:set", handler);

    try {
      await cache.set(key, { data: "test" });
      expect(setEvents).toHaveLength(1);
      expect(setEvents[0]!.cacheName).toBe(cacheName);
      expect(setEvents[0]!.keys).toEqual([key]);
    } finally {
      valkeyEvents.off("cache:set", handler);
      await cache.delete(key);
    }
  });

  it("ValkeyCache emits cache:delete event via delete()", async () => {
    const cache = new ValkeyCache({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });
    const key = `test-delete-key-${Math.random().toString(36).slice(2)}`;
    const cacheName = cache.prefix;

    const deleteEvents: { cacheName: string; keys: string[] }[] = [];
    const handler = (data: { cacheName: string; keys: string[] }) => {
      if (data.cacheName === cacheName) deleteEvents.push(data);
    };
    valkeyEvents.on("cache:delete", handler);
    try {
      await cache.delete(key);
      expect(deleteEvents).toHaveLength(1);
      expect(deleteEvents[0]!.cacheName).toBe(cacheName);
      expect(deleteEvents[0]!.keys).toEqual([key]);
    } finally {
      valkeyEvents.off("cache:delete", handler);
    }
  });

  it("ValkeyCache emits cache:set event via cacheGetByAnyBatch on miss (fire-and-forget)", async () => {
    const cache = new ValkeyCache({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });
    const key = `test-set-batch-key-${Math.random().toString(36).slice(2)}`;
    const cacheName = cache.prefix;

    const setEvents: { cacheName: string; keys: string[] }[] = [];
    const handler = (data: { cacheName: string; keys: string[] }) => {
      if (data.cacheName === cacheName) setEvents.push(data);
    };
    valkeyEvents.on("cache:set", handler);

    try {
      const batchFn = cache.cacheGetByAnyBatch(() => Promise.resolve([{ value: "fetched" }]));
      await batchFn([key]);
      await waitFor(() => setEvents.length > 0);
      expect(setEvents).toHaveLength(1);
      expect(setEvents[0]!.cacheName).toBe(cacheName);
      expect(setEvents[0]!.keys).toEqual([key]);
    } finally {
      valkeyEvents.off("cache:set", handler);
      await cache.delete(key);
    }
  });

  it("ValkeyCache emits cache:invalidate event via invalidate()", async () => {
    const cache = new ValkeyCache({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });
    const cacheName = cache.prefix;

    await cache.set("key1", { data: "test" });

    const invalidateEvents: { cacheName: string }[] = [];
    const handler = (data: { cacheName: string }) => {
      if (data.cacheName === cacheName) invalidateEvents.push(data);
    };
    valkeyEvents.on("cache:invalidate", handler);
    try {
      await cache.invalidate();
      expect(invalidateEvents).toHaveLength(1);
      expect(invalidateEvents[0]!.cacheName).toBe(cacheName);
    } finally {
      valkeyEvents.off("cache:invalidate", handler);
    }
  });
});
