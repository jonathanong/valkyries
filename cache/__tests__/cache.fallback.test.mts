import type { GlideClient } from "@valkey/valkey-glide";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ValkeyCache } from "../../cache.mts";
import { setValkeyErrorHandler } from "../../errors.mts";

/** Creates a GlideClient stub whose invokeScript always rejects with the given message. */
function makeFailingClient(message = "Reached maximum inflight requests"): GlideClient {
  return {
    invokeScript: () => Promise.reject(new Error(message)),
  } as unknown as GlideClient;
}

function makeCache(prefix: string, fallbackOnReadError?: boolean) {
  return new ValkeyCache({
    prefix,
    ttlSeconds: 10,
    client: makeFailingClient(),
    fallbackOnReadError,
  });
}

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
