import { ValkeyCache } from "../../cache.mts";
import { multiCacheGetByAnyBatch } from "../../cache/multi-batch-read.mts";
import { it, expect, describe } from "vitest";

const uid = () => Math.random().toString(36).slice(2);

describe("multiCacheGetByAnyBatch", () => {
  describe("non-cluster path (clusterSafe: false, default)", () => {
    it("returns correct values for 2+ caches, all keys found", async () => {
      const cacheA = new ValkeyCache({ prefix: `mcgab-a-${uid()}`, ttlSeconds: 10 });
      const cacheB = new ValkeyCache({ prefix: `mcgab-b-${uid()}`, ttlSeconds: 10 });

      const keyA1 = `ka1-${uid()}`;
      const keyA2 = `ka2-${uid()}`;
      const keyB1 = `kb1-${uid()}`;

      await cacheA.set(keyA1, { id: keyA1 });
      await cacheA.set(keyA2, { id: keyA2 });
      await cacheB.set(keyB1, { id: keyB1 });

      const [resultA, resultB] = await multiCacheGetByAnyBatch([
        { cache: cacheA, keys: [keyA1, keyA2] },
        { cache: cacheB, keys: [keyB1] },
      ]);

      expect(resultA).toHaveLength(2);
      expect(resultA[0]).toEqual({ id: keyA1 });
      expect(resultA[1]).toEqual({ id: keyA2 });
      expect(resultB).toHaveLength(1);
      expect(resultB[0]).toEqual({ id: keyB1 });

      await cacheA.delete(keyA1, keyA2);
      await cacheB.delete(keyB1);
    });

    it("returns null for missing keys in the right position", async () => {
      const cacheA = new ValkeyCache({ prefix: `mcgab-miss-a-${uid()}`, ttlSeconds: 10 });
      const cacheB = new ValkeyCache({ prefix: `mcgab-miss-b-${uid()}`, ttlSeconds: 10 });

      const keyA1 = `ka1-${uid()}`;
      const keyA2 = `ka2-${uid()}`; // not set
      const keyB1 = `kb1-${uid()}`; // not set

      await cacheA.set(keyA1, { id: keyA1 });

      const [resultA, resultB] = await multiCacheGetByAnyBatch([
        { cache: cacheA, keys: [keyA1, keyA2] },
        { cache: cacheB, keys: [keyB1] },
      ]);

      expect(resultA[0]).toEqual({ id: keyA1 });
      expect(resultA[1]).toBeNull();
      expect(resultB[0]).toBeNull();

      await cacheA.delete(keyA1);
    });

    it("returns empty array for a config with empty keys", async () => {
      const cacheA = new ValkeyCache({ prefix: `mcgab-empty-a-${uid()}`, ttlSeconds: 10 });
      const cacheB = new ValkeyCache({ prefix: `mcgab-empty-b-${uid()}`, ttlSeconds: 10 });

      const keyB1 = `kb1-${uid()}`;
      await cacheB.set(keyB1, { id: keyB1 });

      const [resultA, resultB] = await multiCacheGetByAnyBatch([
        { cache: cacheA, keys: [] },
        { cache: cacheB, keys: [keyB1] },
      ]);

      expect(resultA).toHaveLength(0);
      expect(resultB[0]).toEqual({ id: keyB1 });

      await cacheB.delete(keyB1);
    });

    it("deduplicates keys within a cache and returns result at both positions", async () => {
      const cache = new ValkeyCache({ prefix: `mcgab-dedup-${uid()}`, ttlSeconds: 10 });
      const key = `k-${uid()}`;
      await cache.set(key, { id: key });

      const [result] = await multiCacheGetByAnyBatch([{ cache, keys: [key, key] }]);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: key });
      expect(result[1]).toEqual({ id: key });

      await cache.delete(key);
    });

    it("handles all-empty configs (no keys at all)", async () => {
      const cacheA = new ValkeyCache({ prefix: `mcgab-allempty-a-${uid()}`, ttlSeconds: 10 });
      const cacheB = new ValkeyCache({ prefix: `mcgab-allempty-b-${uid()}`, ttlSeconds: 10 });

      const [resultA, resultB] = await multiCacheGetByAnyBatch([
        { cache: cacheA, keys: [] },
        { cache: cacheB, keys: [] },
      ]);

      expect(resultA).toHaveLength(0);
      expect(resultB).toHaveLength(0);
    });

    it("returns null for null/empty-string keys", async () => {
      const cache = new ValkeyCache({ prefix: `mcgab-nullkey-${uid()}`, ttlSeconds: 10 });
      const validKey = `vk-${uid()}`;
      await cache.set(validKey, { id: validKey });

      const [result] = await multiCacheGetByAnyBatch([
        { cache, keys: [null as unknown as string, validKey, "" as unknown as string] },
      ]);

      expect(result[0]).toBeNull();
      expect(result[1]).toEqual({ id: validKey });
      expect(result[2]).toBeNull();

      await cache.delete(validKey);
    });
  });

  describe("cluster-safe path (clusterSafe: true)", () => {
    it("returns correct values for 2+ caches, all keys found", async () => {
      const cacheA = new ValkeyCache({ prefix: `mcgab-cs-a-${uid()}`, ttlSeconds: 10 });
      const cacheB = new ValkeyCache({ prefix: `mcgab-cs-b-${uid()}`, ttlSeconds: 10 });

      const keyA1 = `ka1-${uid()}`;
      const keyB1 = `kb1-${uid()}`;

      await cacheA.set(keyA1, { id: keyA1 });
      await cacheB.set(keyB1, { id: keyB1 });

      const [resultA, resultB] = await multiCacheGetByAnyBatch(
        [
          { cache: cacheA, keys: [keyA1] },
          { cache: cacheB, keys: [keyB1] },
        ],
        { clusterSafe: true },
      );

      expect(resultA[0]).toEqual({ id: keyA1 });
      expect(resultB[0]).toEqual({ id: keyB1 });

      await cacheA.delete(keyA1);
      await cacheB.delete(keyB1);
    });

    it("returns null for missing keys in the right position", async () => {
      const cacheA = new ValkeyCache({ prefix: `mcgab-cs-miss-a-${uid()}`, ttlSeconds: 10 });
      const cacheB = new ValkeyCache({ prefix: `mcgab-cs-miss-b-${uid()}`, ttlSeconds: 10 });

      const keyA1 = `ka1-${uid()}`;
      const keyA2 = `ka2-${uid()}`; // not set
      const keyB1 = `kb1-${uid()}`; // not set

      await cacheA.set(keyA1, { id: keyA1 });

      const [resultA, resultB] = await multiCacheGetByAnyBatch(
        [
          { cache: cacheA, keys: [keyA1, keyA2] },
          { cache: cacheB, keys: [keyB1] },
        ],
        { clusterSafe: true },
      );

      expect(resultA[0]).toEqual({ id: keyA1 });
      expect(resultA[1]).toBeNull();
      expect(resultB[0]).toBeNull();

      await cacheA.delete(keyA1);
    });

    it("returns empty array for a config with empty keys", async () => {
      const cacheA = new ValkeyCache({ prefix: `mcgab-cs-empty-a-${uid()}`, ttlSeconds: 10 });
      const cacheB = new ValkeyCache({ prefix: `mcgab-cs-empty-b-${uid()}`, ttlSeconds: 10 });

      const keyB1 = `kb1-${uid()}`;
      await cacheB.set(keyB1, { id: keyB1 });

      const [resultA, resultB] = await multiCacheGetByAnyBatch(
        [
          { cache: cacheA, keys: [] },
          { cache: cacheB, keys: [keyB1] },
        ],
        { clusterSafe: true },
      );

      expect(resultA).toHaveLength(0);
      expect(resultB[0]).toEqual({ id: keyB1 });

      await cacheB.delete(keyB1);
    });

    it("deduplicates keys within a cache and returns result at both positions", async () => {
      const cache = new ValkeyCache({ prefix: `mcgab-cs-dedup-${uid()}`, ttlSeconds: 10 });
      const key = `k-${uid()}`;
      await cache.set(key, { id: key });

      const [result] = await multiCacheGetByAnyBatch([{ cache, keys: [key, key] }], {
        clusterSafe: true,
      });

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: key });
      expect(result[1]).toEqual({ id: key });

      await cache.delete(key);
    });
  });

  describe("parity between cluster-safe and non-cluster paths", () => {
    it("both paths return the same results for a mixed hit/miss scenario", async () => {
      const cacheA = new ValkeyCache({ prefix: `mcgab-parity-a-${uid()}`, ttlSeconds: 10 });
      const cacheB = new ValkeyCache({ prefix: `mcgab-parity-b-${uid()}`, ttlSeconds: 10 });

      const keyA1 = `ka1-${uid()}`;
      const keyA2 = `ka2-${uid()}`; // not set
      const keyB1 = `kb1-${uid()}`;
      const keyB2 = `kb2-${uid()}`; // not set

      await cacheA.set(keyA1, { source: "cacheA", key: keyA1 });
      await cacheB.set(keyB1, { source: "cacheB", key: keyB1 });

      const configs = [
        { cache: cacheA, keys: [keyA1, keyA2] },
        { cache: cacheB, keys: [keyB1, keyB2] },
      ];

      const nonClusterResult = await multiCacheGetByAnyBatch(configs, { clusterSafe: false });
      const clusterSafeResult = await multiCacheGetByAnyBatch(configs, { clusterSafe: true });

      expect(nonClusterResult).toEqual(clusterSafeResult);

      await cacheA.delete(keyA1);
      await cacheB.delete(keyB1);
    });
  });
});
