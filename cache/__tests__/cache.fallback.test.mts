import type { GlideClient } from "@valkey/valkey-glide";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ValkeyCache } from "../../cache.mts";
import { setValkeyErrorHandler } from "../../errors.mts";

/** Creates a GlideClient stub whose invokeScript always rejects with the given message. */
function makeFailingClient(message = "Reached maximum inflight requests"): GlideClient {
  return {
    invokeScript: () => Promise.reject(new Error(message)),
  } as unknown as GlideClient;
}

/**
 * Creates a GlideClient stub whose invokeScript rejects with a saturation error for the
 * first `failCount` calls, then resolves with `successValue` on subsequent calls.
 */
function makeTransientSaturationClient(
  failCount: number,
  successValue: unknown,
): { client: GlideClient; callCount: () => number } {
  let calls = 0;
  const client = {
    invokeScript: () => {
      calls++;
      if (calls <= failCount) {
        return Promise.reject(new Error("Reached maximum inflight requests"));
      }
      return Promise.resolve(successValue);
    },
  } as unknown as GlideClient;
  return { client, callCount: () => calls };
}

function makeCache(prefix: string, fallbackOnReadError?: boolean) {
  return new ValkeyCache({
    prefix,
    ttlSeconds: 10,
    client: makeFailingClient(),
    fallbackOnReadError,
    // Disable saturation retry so that these fallback tests exercise the fallback
    // path directly without waiting for retry delays.
    inflightRetryAttempts: 1,
  });
}

describe("cache.saturation-retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("single-read: succeeds without fallback when saturation clears after N retries", async () => {
    // Reject twice (saturation), then return a cache miss on the 3rd call.
    // Cache miss result: [null, null, 0] => value null, no TTL, no bloom miss.
    const { client } = makeTransientSaturationClient(2, [null, null, 0]);
    const cache = new ValkeyCache({
      prefix: "test-retry-single",
      ttlSeconds: 10,
      client,
      fallbackOnReadError: true,
      inflightRetryAttempts: 3,
      inflightRetryDelayMs: 50,
    });
    let fetchCount = 0;
    const cachedFn = cache.cacheGetByAny(async (key: string) => {
      fetchCount++;
      return { id: key };
    });

    const promise = cachedFn("my-key");
    await vi.runAllTimersAsync();
    const result = await promise;

    // The cache was a miss so the fetch fn should be called once (no error)
    expect(result).toEqual({ id: "my-key" });
    expect(fetchCount).toBe(1);
  });

  it("batch-read: succeeds without fallback when saturation clears after N retries", async () => {
    // Reject twice, then return a 3-entry batch cache miss result.
    // Each entry: [null, null, 0] × 3 = 9-element flat array (but as nested from script).
    // The batch script returns a flat array: [v0, ttl0, bloom0, v1, ttl1, bloom1, ...]
    const { client } = makeTransientSaturationClient(2, [
      null,
      null,
      0,
      null,
      null,
      0,
      null,
      null,
      0,
    ]);
    const cache = new ValkeyCache({
      prefix: "test-retry-batch",
      ttlSeconds: 10,
      client,
      fallbackOnReadError: true,
      inflightRetryAttempts: 3,
      inflightRetryDelayMs: 50,
    });
    let fetchedKeys: string[] = [];
    const cachedFn = cache.cacheGetByAnyBatch(async (keys: string[]) => {
      fetchedKeys = [...keys];
      return keys.map((k) => ({ id: k }));
    });

    const promise = cachedFn(["a", "b", "c"]);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(fetchedKeys).toEqual(["a", "b", "c"]);
  });

  it("single-read: inflightRetryAttempts option is respected", async () => {
    // Fail 3 times with saturation — with only 2 attempts, will give up after 2 tries.
    const { client, callCount } = makeTransientSaturationClient(3, [null, null, 0]);
    const cache = new ValkeyCache({
      prefix: "test-retry-attempts",
      ttlSeconds: 10,
      client,
      fallbackOnReadError: true,
      inflightRetryAttempts: 2,
      inflightRetryDelayMs: 50,
    });
    let fetchCount = 0;
    const cachedFn = cache.cacheGetByAny(async (key: string) => {
      fetchCount++;
      return { id: key };
    });

    const promise = cachedFn("my-key");
    await vi.runAllTimersAsync();
    const result = await promise;

    // After 2 failed attempts it falls back (fallbackOnReadError=true), fetch fn called
    expect(result).toEqual({ id: "my-key" });
    expect(fetchCount).toBe(1);
    // invokeScript called exactly 2 times (exhausted inflightRetryAttempts=2)
    expect(callCount()).toBe(2);
  });
});

describe("cache.fallback", () => {
  const capturedErrors: Error[] = [];

  beforeEach(() => {
    capturedErrors.length = 0;
    setValkeyErrorHandler((err) => capturedErrors.push(err));
  });

  afterEach(() => {
    setValkeyErrorHandler(() => {});
  });

  describe("cacheGetByAny (single-read)", () => {
    it("falls back to fetch fn and reports error when Valkey read throws (fallbackOnReadError: true by default)", async () => {
      const cache = makeCache("test-single");
      let fetchCount = 0;
      const cachedFn = cache.cacheGetByAny(async (key: string) => {
        fetchCount++;
        return { id: key, data: "from-db" };
      });

      const result = await cachedFn("my-key");

      expect(result).toEqual({ id: "my-key", data: "from-db" });
      expect(fetchCount).toBe(1);
      expect(capturedErrors).toHaveLength(1);
      expect(capturedErrors[0].message).toContain("Reached maximum inflight requests");
    });

    it("returns null when fetch fn returns null after a Valkey read error", async () => {
      const cachedFn = makeCache("test-single").cacheGetByAny(async (_key: string) => null);
      expect(await cachedFn("missing-key")).toBeNull();
      expect(capturedErrors).toHaveLength(1);
    });

    it("rethrows when fallbackOnReadError is false", async () => {
      const cachedFn = makeCache("test-single", false).cacheGetByAny(async () => ({
        data: "no-reach",
      }));
      await expect(cachedFn("key")).rejects.toThrow("Reached maximum inflight requests");
      expect(capturedErrors).toHaveLength(0);
    });

    it("fallbackOnReadError defaults to true on the instance", () => {
      expect(makeCache("test-single").fallbackOnReadError).toBe(true);
    });

    it("fallbackOnReadError: false is stored on the instance", () => {
      expect(makeCache("test-single", false).fallbackOnReadError).toBe(false);
    });
  });

  describe("cacheGetByAnyBatch (batch-read)", () => {
    it("falls back to batchFn and reports error when Valkey read throws (fallbackOnReadError: true by default)", async () => {
      const cache = makeCache("test-batch");
      let fetchedKeys: string[] = [];
      const cachedFn = cache.cacheGetByAnyBatch(async (keys: string[]) => {
        fetchedKeys = [...keys];
        return keys.map((k) => ({ id: k }));
      });

      const result = await cachedFn(["a", "b", "c"]);

      expect(result).toEqual([{ id: "a" }, { id: "b" }, { id: "c" }]);
      expect(fetchedKeys).toEqual(["a", "b", "c"]);
      expect(capturedErrors).toHaveLength(1);
      expect(capturedErrors[0].message).toContain("Reached maximum inflight requests");
    });

    it("scatters batch fallback results back to the original key positions including duplicates", async () => {
      const cachedFn = makeCache("test-batch").cacheGetByAnyBatch(async (keys: string[]) =>
        keys.map((k) => ({ id: k })),
      );
      const result = await cachedFn(["a", "b", "a"]);
      expect(result).toHaveLength(3);
      expect(result[0]).toEqual({ id: "a" });
      expect(result[1]).toEqual({ id: "b" });
      expect(result[2]).toEqual({ id: "a" });
    });

    it("maps null batchFn results to null in fallback output", async () => {
      const cachedFn = makeCache("test-batch").cacheGetByAnyBatch(async (keys: string[]) =>
        keys.map(() => null),
      );
      expect(await cachedFn(["a", "b"])).toEqual([null, null]);
    });

    it("rethrows when fallbackOnReadError is false", async () => {
      const cachedFn = makeCache("test-batch", false).cacheGetByAnyBatch(async (keys: string[]) =>
        keys.map(() => null),
      );
      await expect(cachedFn(["key"])).rejects.toThrow("Reached maximum inflight requests");
      expect(capturedErrors).toHaveLength(0);
    });
  });
});
