import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import type { GlideClient } from "@valkey/valkey-glide";
import { RateLimiter } from "../../rate-limiter.mts";
import { rateLimiterValkeyClient } from "../../clients.mts";
import { valkeyEvents } from "../../events.mts";

function makeLimiter(ttlSeconds = 10) {
  return new RateLimiter({ prefix: `consume${Math.random().toString(36).slice(2)}`, ttlSeconds });
}

describe("RateLimiter.consume", () => {
  it("charges exactly cost units on every key when within budget", async () => {
    const limiter = makeLimiter();
    try {
      const result = await limiter.consume(["a", "b"], { threshold: 10, cost: 4 });
      expect(result).toEqual({ limited: false, counts: [4, 4], retryAfterMs: 0 });
      expect(await limiter.get(["a", "b"])).toEqual([4, 4]);
      const ttl = await rateLimiterValkeyClient.ttl(limiter.getKey("a"));
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(10);
    } finally {
      await limiter.invalidate();
    }
  });

  it("consumes nothing when over budget and returns pre-call counts", async () => {
    const limiter = makeLimiter();
    try {
      await limiter.consume(["a"], { threshold: 10, cost: 5 });
      const result = await limiter.consume(["a"], { threshold: 10, cost: 5 });
      expect(result.limited).toBe(true);
      expect(result.counts).toEqual([5]);
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(await limiter.get(["a"])).toEqual([5]);
      // A smaller charge that fits still succeeds afterwards
      expect(await limiter.consume(["a"], { threshold: 10, cost: 4 })).toEqual({
        limited: false,
        counts: [9],
        retryAfterMs: 0,
      });
    } finally {
      await limiter.invalidate();
    }
  });

  it("charges no key when any key is over budget", async () => {
    const limiter = makeLimiter();
    try {
      await limiter.consume(["busy"], { threshold: 5, cost: 3 });
      const result = await limiter.consume(["idle", "busy", "other"], { threshold: 5, cost: 2 });
      expect(result.limited).toBe(true);
      expect(result.counts).toEqual([0, 3, 0]);
      expect(await limiter.get(["idle", "busy", "other"])).toEqual([0, 3, 0]);
    } finally {
      await limiter.invalidate();
    }
  });

  it("allows the same number of cost-1 calls as addAndCheck", async () => {
    const consumer = makeLimiter();
    const checker = makeLimiter();
    try {
      const threshold = 5;
      let consumeAllowed = 0;
      let checkAllowed = 0;
      for (let i = 0; i < threshold + 2; i++) {
        if (!(await consumer.consume(["x"], { threshold })).limited) consumeAllowed++;
        if (!(await checker.addAndCheck(["x"], threshold)).limited) checkAllowed++;
      }
      expect(consumeAllowed).toBe(threshold - 1);
      expect(consumeAllowed).toBe(checkAllowed);
      // Refused consumes never add, unlike addAndCheck
      expect(await consumer.get(["x"])).toEqual([threshold - 1]);
    } finally {
      await consumer.invalidate();
      await checker.invalidate();
    }
  });

  it("matches N separate cost-1 calls at the budget boundary", async () => {
    const limiter = makeLimiter();
    try {
      // threshold 5 allows 4 units total
      expect((await limiter.consume(["a"], { threshold: 5, cost: 4 })).limited).toBe(false);
      expect((await limiter.consume(["a"], { threshold: 5 })).limited).toBe(true);
      expect((await limiter.consume(["b"], { threshold: 5, cost: 5 })).limited).toBe(true);
    } finally {
      await limiter.invalidate();
    }
  });

  it("reports retryAfterMs until enough of the oldest entries expire", async () => {
    const limiter = makeLimiter(10);
    try {
      await limiter.consume(["a"], { threshold: 10, cost: 3 });
      await sleep(600);
      await limiter.consume(["a"], { threshold: 10, cost: 3 });

      // need = 6 + 4 - 10 + 1 = 1: only the first batch must expire (~9400ms left)
      const first = await limiter.consume(["a"], { threshold: 10, cost: 4 });
      expect(first.limited).toBe(true);
      expect(first.retryAfterMs).toBeGreaterThan(8000);
      expect(first.retryAfterMs).toBeLessThanOrEqual(9500);

      // need = 6 + 7 - 10 + 1 = 4: the second batch must also expire (~10000ms left)
      const second = await limiter.consume(["a"], { threshold: 10, cost: 7 });
      expect(second.limited).toBe(true);
      expect(second.retryAfterMs).toBeGreaterThan(first.retryAfterMs);
      expect(second.retryAfterMs).toBeLessThanOrEqual(10_000);

      // The longest wait across limited keys wins
      await limiter.consume(["b"], { threshold: 10, cost: 9 });
      const multi = await limiter.consume(["a", "b"], { threshold: 10, cost: 4 });
      expect(multi.limited).toBe(true);
      expect(multi.retryAfterMs).toBeGreaterThan(first.retryAfterMs);
    } finally {
      await limiter.invalidate();
    }
  });

  it("succeeds once retryAfterMs has elapsed", async () => {
    const limiter = makeLimiter();
    try {
      await limiter.consume(["a"], { threshold: 3, cost: 2, ttlSeconds: 1 });
      const refused = await limiter.consume(["a"], { threshold: 3, cost: 2, ttlSeconds: 1 });
      expect(refused.limited).toBe(true);
      expect(refused.retryAfterMs).toBeGreaterThan(0);
      expect(refused.retryAfterMs).toBeLessThanOrEqual(1000);
      await sleep(refused.retryAfterMs + 50);
      expect((await limiter.consume(["a"], { threshold: 3, cost: 2, ttlSeconds: 1 })).limited).toBe(
        false,
      );
    } finally {
      await limiter.invalidate();
    }
  });

  it("refuses cost >= threshold with the ttl as the retry", async () => {
    const limiter = makeLimiter();
    try {
      expect(await limiter.consume(["a"], { threshold: 3, cost: 3, ttlSeconds: 7 })).toEqual({
        limited: true,
        counts: [0],
        retryAfterMs: 7000,
      });
      expect(await limiter.get(["a"])).toEqual([0]);
    } finally {
      await limiter.invalidate();
    }
  });

  it("supports large costs across multiple ZADD chunks", async () => {
    const limiter = makeLimiter();
    try {
      const result = await limiter.consume(["a"], { threshold: 20_000, cost: 10_000 });
      expect(result).toEqual({ limited: false, counts: [10_000], retryAfterMs: 0 });
      expect(await limiter.get(["a"])).toEqual([10_000]);
    } finally {
      await limiter.invalidate();
    }
  });

  it("filters falsy ids and returns an empty result when none remain", async () => {
    const limiter = makeLimiter();
    try {
      expect(await limiter.consume(["", ""], { threshold: 5 })).toEqual({
        limited: false,
        counts: [],
        retryAfterMs: 0,
      });
      expect(await limiter.consume(["", "a"], { threshold: 5, cost: 2 })).toEqual({
        limited: false,
        counts: [2],
        retryAfterMs: 0,
      });
    } finally {
      await limiter.invalidate();
    }
  });

  it("charges duplicate ids once per occurrence against one budget", async () => {
    const limiter = makeLimiter();
    try {
      // 2 occurrences x cost 3 = 6 units, which reaches threshold 6
      const refused = await limiter.consume(["a", "a"], { threshold: 6, cost: 3 });
      expect(refused).toEqual({ limited: true, counts: [0, 0], retryAfterMs: 10_000 });
      expect(await limiter.get(["a"])).toEqual([0]);

      expect(await limiter.consume(["a", "b", "a"], { threshold: 7, cost: 3 })).toEqual({
        limited: false,
        counts: [6, 3, 6],
        retryAfterMs: 0,
      });
      expect(await limiter.get(["a", "b"])).toEqual([6, 3]);
    } finally {
      await limiter.invalidate();
    }
  });

  it("treats a fractional threshold like its ceiling", async () => {
    const limiter = makeLimiter();
    try {
      await limiter.consume(["a"], { threshold: 10, cost: 1 });
      // ceil(2.5) = 3: count 1 + cost 2 reaches it
      const result = await limiter.consume(["a"], { threshold: 2.5, cost: 2 });
      expect(result.limited).toBe(true);
      expect(result.counts).toEqual([1]);
      expect(result.retryAfterMs).toBeGreaterThan(9000);
      expect((await limiter.consume(["a"], { threshold: 2.5, cost: 1 })).limited).toBe(false);
    } finally {
      await limiter.invalidate();
    }
  });

  it("rejects invalid cost and threshold", async () => {
    const limiter = makeLimiter();
    for (const cost of [0, -1, 1.5, Number.NaN, 10_001]) {
      await expect(limiter.consume(["a"], { threshold: 5, cost })).rejects.toThrow(
        "RateLimiter.consume: cost must be an integer between 1 and 10000",
      );
    }
    for (const threshold of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(limiter.consume(["a"], { threshold })).rejects.toThrow(
        "RateLimiter.consume: threshold must be a finite number greater than 0",
      );
    }
  });

  it("emits add only when charged and get on every call", async () => {
    const limiter = makeLimiter();
    const adds = vi.fn();
    const gets = vi.fn();
    valkeyEvents.on("rate-limiter:add", adds);
    valkeyEvents.on("rate-limiter:get", gets);
    try {
      await limiter.consume(["a"], { threshold: 3, cost: 2 });
      await limiter.consume(["a"], { threshold: 3, cost: 2 });
      expect(adds).toHaveBeenCalledTimes(1);
      expect(adds).toHaveBeenCalledWith({ prefix: limiter.prefix, ids: ["a"] });
      expect(gets).toHaveBeenCalledTimes(2);
      expect(gets).toHaveBeenLastCalledWith({ prefix: limiter.prefix, ids: ["a"], counts: [2] });
    } finally {
      valkeyEvents.off("rate-limiter:add", adds);
      valkeyEvents.off("rate-limiter:get", gets);
      await limiter.invalidate();
    }
  });

  it("fails open on an unexpected Valkey response", async () => {
    const client = { invokeScript: () => Promise.resolve("oops") } as unknown as GlideClient;
    const limiter = new RateLimiter({ prefix: "consume-malformed", ttlSeconds: 10, client });
    const adds = vi.fn();
    valkeyEvents.on("rate-limiter:add", adds);
    try {
      expect(await limiter.consume(["a", "b"], { threshold: 1 })).toEqual({
        limited: false,
        counts: [0, 0],
        retryAfterMs: 0,
      });
      expect(adds).not.toHaveBeenCalled();
    } finally {
      valkeyEvents.off("rate-limiter:add", adds);
    }
  });
});
