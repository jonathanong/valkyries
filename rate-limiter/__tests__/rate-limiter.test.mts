import { RateLimiter } from "../../rate-limiter.mts";
import { rateLimiterValkeyClient } from "../../clients.mts";
import { valkeyEvents } from "../../events.mts";
import { RateLimiterConfigurationError } from "../../errors.mts";
import { it, expect, describe, vi } from "vitest";
import assert from "node:assert";
import type { GlideClient } from "@valkey/valkey-glide";

describe("rate-limiter.generated", () => {
  it("RateLimiter validates prefix and ttl", () => {
    expect(() => new RateLimiter({ prefix: "", ttlSeconds: 10 })).toThrow(
      RateLimiterConfigurationError,
    );
    expect(() => new RateLimiter({ prefix: " ", ttlSeconds: 10 })).toThrow(
      "RateLimiter requires a prefix",
    );
    expect(() => new RateLimiter({ prefix: "test", ttlSeconds: 0 })).toThrow(
      RateLimiterConfigurationError,
    );
    expect(() => new RateLimiter({ prefix: "test", ttlSeconds: Number.POSITIVE_INFINITY })).toThrow(
      "RateLimiter: ttlSeconds must be greater than 0",
    );
  });

  it("RateLimiter", async () => {
    const rateLimiter = new RateLimiter({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });

    try {
      await rateLimiter.add(["123", "456", "789"]);

      const results = await rateLimiter.get(["123", "456", "789"]);
      expect(results).toEqual([1, 1, 1]);

      await rateLimiter.add(["123", "456", "789"]);

      const results2 = await rateLimiter.get(["123", "456", "789"]);
      expect(results2).toEqual([2, 2, 2]);

      const isRateLimited = await rateLimiter.isRateLimited(["123", "456", "789"], 1);
      assert(isRateLimited);
    } finally {
      await rateLimiter.delete("123", "456", "789");
    }

    const results3 = await rateLimiter.get(["123", "456", "789"]);
    expect(results3).toEqual([0, 0, 0]);
  });

  it("RateLimiter.invalidate", async () => {
    const rateLimiter = new RateLimiter({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });

    await rateLimiter.add(["123", "456", "789"]);

    const results = await rateLimiter.get(["123", "456", "789"]);
    expect(results).toEqual([1, 1, 1]);

    await rateLimiter.invalidate();

    const results2 = await rateLimiter.get(["123", "456", "789"]);
    expect(results2).toEqual([0, 0, 0]);
  }, 15_000);

  it("RateLimiter.isRateLimited returns true when threshold exceeded", async () => {
    const rateLimiter = new RateLimiter({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });

    try {
      await rateLimiter.add(["123"]);
      await rateLimiter.add(["123"]);

      const isLimited = await rateLimiter.isRateLimited(["123"], 2);
      expect(isLimited).toBe(true);
    } finally {
      await rateLimiter.delete("123");
    }
  });

  it("RateLimiter.isRateLimited returns false when threshold not exceeded", async () => {
    const rateLimiter = new RateLimiter({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });

    try {
      await rateLimiter.add(["123"]);

      const isLimited = await rateLimiter.isRateLimited(["123"], 2);
      expect(isLimited).toBe(false);
    } finally {
      await rateLimiter.delete("123");
    }
  });

  it("RateLimiter.isRateLimited uses custom TTL to include or exclude old entries", async () => {
    const prefix = `test${Math.random().toString(36).slice(2)}`;
    const rateLimiter = new RateLimiter({ prefix, ttlSeconds: 60 });

    // Insert an entry 30 seconds in the past: outside a 1-second window but inside a 60-second window.
    // The 30s offset gives ≥29s of tolerance against client/server clock skew when checking the 1s window.
    const key = rateLimiter.getKey("123");
    await rateLimiterValkeyClient.zadd(key, [{ element: "old-event", score: Date.now() - 30_000 }]);

    // With a 1-second window, the old entry is outside — not rate limited
    expect(await rateLimiter.isRateLimited(["123"], 1, 1)).toBe(false);
    // With a 60-second window, the old entry is inside — rate limited
    expect(await rateLimiter.isRateLimited(["123"], 1, 60)).toBe(true);

    await rateLimiter.delete("123");
  });

  it("RateLimiter.get handles empty array", async () => {
    const rateLimiter = new RateLimiter({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });

    const results = await rateLimiter.get([]);
    expect(results).toEqual([]);
  });

  it("RateLimiter.get filters falsy ids and aligns counts to filtered input", async () => {
    // counts.length must equal filteredIds.length, not ids.length
    const prefix = `test${Math.random().toString(36).slice(2)}`;
    const rateLimiter = new RateLimiter({ prefix, ttlSeconds: 10 });
    try {
      await rateLimiter.add(["user-b"]);
      const counts = await rateLimiter.get(["", "user-b"]);
      expect(counts).toHaveLength(1); // only 'user-b' survives filter
      expect(counts[0]).toBe(1);
    } finally {
      await rateLimiter.delete("user-b");
    }
  });

  it("RateLimiter.delete handles empty array", async () => {
    const rateLimiter = new RateLimiter({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });

    const result = await rateLimiter.delete();
    expect(result).toBe(0);
  });

  it("RateLimiter counts each ID independently", async () => {
    const rateLimiter = new RateLimiter({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });

    await rateLimiter.add(["user-1"]);
    await rateLimiter.add(["user-1"]);
    await rateLimiter.add(["user-2"]);

    const results = await rateLimiter.get(["user-1", "user-2", "user-3"]);
    expect(results[0]).toBe(2);
    expect(results[1]).toBe(1);
    expect(results[2]).toBe(0);

    await rateLimiter.delete("user-1", "user-2");
  });

  it("RateLimiter.isRateLimited checks any ID exceeding threshold", async () => {
    const rateLimiter = new RateLimiter({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });

    await rateLimiter.add(["a"]);
    await rateLimiter.add(["a"]);
    await rateLimiter.add(["b"]); // b only has 1 event

    // threshold=2: a exceeds, b does not — result is true because any exceeds
    expect(await rateLimiter.isRateLimited(["a", "b"], 2)).toBe(true);
    // threshold=3: neither exceeds
    expect(await rateLimiter.isRateLimited(["a", "b"], 3)).toBe(false);

    await rateLimiter.delete("a", "b");
  });

  it("RateLimiter sliding window: stale entries outside TTL window are not counted", async () => {
    const prefix = `test${Math.random().toString(36).slice(2)}`;
    const rateLimiter = new RateLimiter({ prefix, ttlSeconds: 60 });

    // Manually insert a sorted-set entry with a score far in the past (10 minutes ago)
    const staleScore = Date.now() - 10 * 60 * 1000;
    const key = rateLimiter.getKey("user");
    await rateLimiterValkeyClient.zadd(key, [{ element: "old-event", score: staleScore }]);

    // With a 1-second window, the 10-minute-old entry is outside the window
    const result = await rateLimiter.get(["user"], 1);
    expect(result[0]).toBe(0);

    // With a large window (20 minutes), it should be visible
    const resultLarge = await rateLimiter.get(["user"], 20 * 60);
    expect(resultLarge[0]).toBe(1);

    await rateLimiter.delete("user");
  });

  it("RateLimiter emits rate-limiter:add event after write", async () => {
    const prefix = `test${Math.random().toString(36).slice(2)}`;
    const rateLimiter = new RateLimiter({ prefix, ttlSeconds: 10 });

    const addEvents: { prefix: string; ids: string[] }[] = [];
    const handler = (data: { prefix: string; ids: string[] }) => {
      if (data.prefix === prefix) addEvents.push(data);
    };
    valkeyEvents.on("rate-limiter:add", handler);
    try {
      await rateLimiter.add(["user-a"]);
      expect(addEvents).toHaveLength(1);
      expect(addEvents[0]!.prefix).toBe(prefix);
      expect(addEvents[0]!.ids).toEqual(["user-a"]);
    } finally {
      valkeyEvents.off("rate-limiter:add", handler);
      await rateLimiter.delete("user-a");
    }
  });

  it("RateLimiter emits rate-limiter:get event after read", async () => {
    const prefix = `test${Math.random().toString(36).slice(2)}`;
    const rateLimiter = new RateLimiter({ prefix, ttlSeconds: 10 });

    await rateLimiter.add(["user-b"]);

    const getEvents: { prefix: string; ids: string[]; counts: number[] }[] = [];
    const handler = (data: { prefix: string; ids: string[]; counts: number[] }) => {
      if (data.prefix === prefix) getEvents.push(data);
    };
    valkeyEvents.on("rate-limiter:get", handler);
    try {
      await rateLimiter.get(["user-b"]);
      expect(getEvents).toHaveLength(1);
      expect(getEvents[0]!.prefix).toBe(prefix);
      expect(getEvents[0]!.ids).toEqual(["user-b"]);
      expect(getEvents[0]!.counts).toEqual([1]);
    } finally {
      valkeyEvents.off("rate-limiter:get", handler);
      await rateLimiter.delete("user-b");
    }
  });

  it("RateLimiter emits rate-limiter:delete event after delete", async () => {
    const prefix = `test${Math.random().toString(36).slice(2)}`;
    const rateLimiter = new RateLimiter({ prefix, ttlSeconds: 10 });

    await rateLimiter.add(["user-c"]);

    const deleteEvents: { prefix: string; ids: string[] }[] = [];
    const handler = (data: { prefix: string; ids: string[] }) => {
      if (data.prefix === prefix) deleteEvents.push(data);
    };
    valkeyEvents.on("rate-limiter:delete", handler);
    try {
      await rateLimiter.delete("user-c");
      expect(deleteEvents).toHaveLength(1);
      expect(deleteEvents[0]!.prefix).toBe(prefix);
      expect(deleteEvents[0]!.ids).toEqual(["user-c"]);
    } finally {
      valkeyEvents.off("rate-limiter:delete", handler);
    }
  });

  it("RateLimiter emits rate-limiter:invalidate event after invalidate", async () => {
    const prefix = `test${Math.random().toString(36).slice(2)}`;
    const rateLimiter = new RateLimiter({ prefix, ttlSeconds: 10 });

    await rateLimiter.add(["user-d"]);

    const invalidateEvents: { prefix: string }[] = [];
    const handler = (data: { prefix: string }) => {
      if (data.prefix === prefix) invalidateEvents.push(data);
    };
    valkeyEvents.on("rate-limiter:invalidate", handler);
    try {
      await rateLimiter.invalidate();
      expect(invalidateEvents).toHaveLength(1);
      expect(invalidateEvents[0]!.prefix).toBe(prefix);
    } finally {
      valkeyEvents.off("rate-limiter:invalidate", handler);
    }
  });

  it("RateLimiter.addAndCheck atomically adds and returns counts", async () => {
    const rateLimiter = new RateLimiter({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });

    try {
      const result = await rateLimiter.addAndCheck(["abc"], 5);
      expect(result.counts).toEqual([1]);
      expect(result.limited).toBe(false);

      const result2 = await rateLimiter.addAndCheck(["abc"], 5);
      expect(result2.counts).toEqual([2]);
      expect(result2.limited).toBe(false);
    } finally {
      await rateLimiter.delete("abc");
    }
  });

  it("RateLimiter.addAndCheck blocks on the Nth call when threshold=N", async () => {
    // addAndCheck adds then counts: threshold N allows N-1 requests, blocks the Nth
    const rateLimiter = new RateLimiter({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });

    try {
      // First 2 calls: allowed (count 1, 2 — both < threshold 3)
      expect((await rateLimiter.addAndCheck(["x"], 3)).limited).toBe(false);
      expect((await rateLimiter.addAndCheck(["x"], 3)).limited).toBe(false);
      // Third call: count reaches 3 — blocked
      expect((await rateLimiter.addAndCheck(["x"], 3)).limited).toBe(true);
    } finally {
      await rateLimiter.delete("x");
    }
  });

  it("RateLimiter.addAndCheck returns limited=true when any ID exceeds threshold", async () => {
    const rateLimiter = new RateLimiter({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });

    try {
      // Add 'a' twice so it hits threshold=2
      await rateLimiter.addAndCheck(["a"], 2);
      const result = await rateLimiter.addAndCheck(["a", "b"], 2);
      // 'a' count=2 >= threshold=2 → limited; 'b' count=1 < threshold
      expect(result.limited).toBe(true);
      expect(result.counts[0]).toBe(2);
      expect(result.counts[1]).toBe(1);
    } finally {
      await rateLimiter.delete("a", "b");
    }
  });

  it("RateLimiter.addAndCheck respects custom ttlSeconds override", async () => {
    const prefix = `test${Math.random().toString(36).slice(2)}`;
    const rateLimiter = new RateLimiter({ prefix, ttlSeconds: 60 });

    // Manually insert an entry 30 seconds in the past: outside a 1-second window, inside a 60-second window.
    const key = rateLimiter.getKey("ttl-test");
    await rateLimiterValkeyClient.zadd(key, [{ element: "old-event", score: Date.now() - 30_000 }]);

    try {
      // With a 1-second window, the old entry is outside — count is 1 (only the new ZADD)
      const result = await rateLimiter.addAndCheck(["ttl-test"], 10, 1);
      expect(result.counts[0]).toBe(1);
      expect(result.limited).toBe(false);
    } finally {
      await rateLimiter.delete("ttl-test");
    }
  });

  it("RateLimiter.addAndCheck with empty array returns empty counts and not limited", async () => {
    const rateLimiter = new RateLimiter({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });

    const result = await rateLimiter.addAndCheck([], 5);
    expect(result.counts).toEqual([]);
    expect(result.limited).toBe(false);
  });

  it("RateLimiter.addAndCheck filters falsy ids and aligns counts to filtered input", async () => {
    // counts.length must equal filteredIds.length, not ids.length
    const prefix = `test${Math.random().toString(36).slice(2)}`;
    const rateLimiter = new RateLimiter({ prefix, ttlSeconds: 10 });
    try {
      const result = await rateLimiter.addAndCheck(["", "user-a"], 5);
      expect(result.counts).toHaveLength(1); // only 'user-a' survives filter
      expect(result.counts[0]).toBe(1); // first (and only) call for this id
      expect(result.limited).toBe(false);
    } finally {
      await rateLimiter.delete("user-a");
    }
  });

  it("RateLimiter.addAndCheck at exact threshold boundary (threshold=1, count=1 means limited)", async () => {
    const rateLimiter = new RateLimiter({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });

    try {
      // threshold=1: the very first call increments to count=1, which >= 1 → limited
      const result = await rateLimiter.addAndCheck(["boundary"], 1);
      expect(result.counts).toEqual([1]);
      expect(result.limited).toBe(true);
    } finally {
      await rateLimiter.delete("boundary");
    }
  });

  it("RateLimiter.addAndCheck with multiple keys, some over threshold and some under", async () => {
    const rateLimiter = new RateLimiter({
      prefix: `test${Math.random().toString(36).slice(2)}`,
      ttlSeconds: 10,
    });

    try {
      // Pre-load 'hot' with 4 events
      await rateLimiter.addAndCheck(["hot"], 10);
      await rateLimiter.addAndCheck(["hot"], 10);
      await rateLimiter.addAndCheck(["hot"], 10);
      await rateLimiter.addAndCheck(["hot"], 10);

      // Now check both together with threshold=5: hot has 5 (limited), cold has 1 (not limited)
      const result = await rateLimiter.addAndCheck(["hot", "cold"], 5);
      expect(result.counts[0]).toBe(5); // hot: 5th increment
      expect(result.counts[1]).toBe(1); // cold: 1st increment
      expect(result.limited).toBe(true); // hot >= 5
    } finally {
      await rateLimiter.delete("hot", "cold");
    }
  });

  it("RateLimiter.addAndCheck emits rate-limiter:add and rate-limiter:get events unconditionally", async () => {
    // Both events must fire unconditionally — even for rejected requests (limited=true)
    const prefix = `test${Math.random().toString(36).slice(2)}`;
    const rateLimiter = new RateLimiter({ prefix, ttlSeconds: 10 });

    const addEvents: { prefix: string; ids: string[] }[] = [];
    const getEvents: { prefix: string; ids: string[]; counts: number[] }[] = [];
    const addHandler = (data: { prefix: string; ids: string[] }) => {
      if (data.prefix === prefix) addEvents.push(data);
    };
    const getHandler = (data: { prefix: string; ids: string[]; counts: number[] }) => {
      if (data.prefix === prefix) getEvents.push(data);
    };
    valkeyEvents.on("rate-limiter:add", addHandler);
    valkeyEvents.on("rate-limiter:get", getHandler);
    try {
      // First call: count=1, threshold=5 → limited=false
      const result1 = await rateLimiter.addAndCheck(["user-e"], 5);
      expect(result1.limited).toBe(false);
      expect(addEvents).toHaveLength(1);
      expect(addEvents[0]!.ids).toEqual(["user-e"]);
      expect(getEvents).toHaveLength(1);
      expect(getEvents[0]!.ids).toEqual(["user-e"]);
      expect(getEvents[0]!.counts).toEqual([1]);

      // Second call: threshold=1 → count=2 >= 1 → limited=true; events still fire
      const result2 = await rateLimiter.addAndCheck(["user-e"], 1);
      expect(result2.limited).toBe(true);
      expect(addEvents).toHaveLength(2);
      expect(getEvents).toHaveLength(2);
      expect(getEvents[1]!.counts).toEqual([2]);
    } finally {
      valkeyEvents.off("rate-limiter:add", addHandler);
      valkeyEvents.off("rate-limiter:get", getHandler);
      await rateLimiter.delete("user-e");
    }
  });

  it("RateLimiter.add handles only falsy ids without calling Valkey", async () => {
    const invokeScript = vi.fn();
    const client = {
      invokeScript,
    } as unknown as GlideClient;
    const rateLimiter = new RateLimiter({ prefix: "mocked", ttlSeconds: 10, client });

    await rateLimiter.add([""]);

    expect(invokeScript).not.toHaveBeenCalled();
  });

  it("RateLimiter.get fails open on an unexpected Valkey response", async () => {
    const client = {
      invokeScript: vi.fn().mockResolvedValue("unexpected"),
    } as unknown as GlideClient;
    const rateLimiter = new RateLimiter({ prefix: "mocked", ttlSeconds: 10, client });

    await expect(rateLimiter.get(["a", "b"])).resolves.toEqual([0, 0]);
  });

  it("RateLimiter.delete handles only falsy ids without calling Valkey", async () => {
    const unlink = vi.fn();
    const client = {
      unlink,
    } as unknown as GlideClient;
    const rateLimiter = new RateLimiter({ prefix: "mocked", ttlSeconds: 10, client });

    await expect(rateLimiter.delete("")).resolves.toBe(0);
    expect(unlink).not.toHaveBeenCalled();
  });

  it("RateLimiter.invalidate can clear every rate-limiter prefix", async () => {
    const prefix = `test${Math.random().toString(36).slice(2)}`;
    const rateLimiter = new RateLimiter({ prefix, ttlSeconds: 10 });
    await rateLimiter.add(["global"]);

    await RateLimiter.invalidate("");

    await expect(rateLimiter.get(["global"])).resolves.toEqual([0]);
  });
});
