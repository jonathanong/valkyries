import { afterEach, beforeEach, expect, it, describe } from "vitest";
import { ValkeyBloomFilter } from "../../bloom-filter.mts";
import { cacheValkeyClient } from "../../clients.mts";

describe("bloom-filter.ready", () => {
  let filter: ValkeyBloomFilter;

  beforeEach(() => {
    filter = new ValkeyBloomFilter({
      name: `test-ready-bloom-${Math.random().toString(36).slice(2)}`,
      capacity: 10_000,
      errorRate: 0.01,
      batchSize: 100,
    });
  });

  afterEach(async () => {
    await filter.delete();
  });

  it("existsIfReady returns null until both ready marker and filter exist", async () => {
    const readyKey = `test-bloom-ready:${crypto.randomUUID()}`;
    try {
      await expect(filter.existsIfReady(readyKey, "alpha.com")).resolves.toBeNull();

      await cacheValkeyClient.set(readyKey, "1");
      await expect(filter.existsIfReady(readyKey, "alpha.com")).resolves.toBeNull();

      await filter.rebuild(["alpha.com"]);
      await expect(filter.existsIfReady(readyKey, "alpha.com")).resolves.toBe(true);
      await expect(filter.existsIfReady(readyKey, "missing.com")).resolves.toBe(false);
    } finally {
      await cacheValkeyClient.unlink([readyKey]);
    }
  });

  it("mexistsIfReady returns null entries until both ready marker and filter exist", async () => {
    const readyKey = `test-bloom-ready:${crypto.randomUUID()}`;
    try {
      await expect(filter.mexistsIfReady(readyKey, ["alpha.com", "missing.com"])).resolves.toEqual([
        null,
        null,
      ]);

      await cacheValkeyClient.set(readyKey, "1");
      await expect(filter.mexistsIfReady(readyKey, ["alpha.com", "missing.com"])).resolves.toEqual([
        null,
        null,
      ]);

      await filter.rebuild(["alpha.com"]);
      await expect(filter.mexistsIfReady(readyKey, ["alpha.com", "missing.com"])).resolves.toEqual([
        true,
        false,
      ]);
    } finally {
      await cacheValkeyClient.unlink([readyKey]);
    }
  });

  it("mexistsIfReady chunks large lookups before invoking Lua", async () => {
    const chunkedFilter = new ValkeyBloomFilter({
      name: `test-ready-bloom-chunked-${Math.random().toString(36).slice(2)}`,
      capacity: 10_000,
      errorRate: 0.01,
      batchSize: 3,
    });
    const readyKey = `test-bloom-ready:${crypto.randomUUID()}`;
    const presentItems = ["alpha.com", "bravo.com", "charlie.com", "delta.com"];
    const lookupItems = [
      "alpha.com",
      "missing-1.com",
      "bravo.com",
      "missing-2.com",
      "charlie.com",
      "missing-3.com",
      "delta.com",
    ];
    try {
      await chunkedFilter.rebuild(presentItems);
      await cacheValkeyClient.set(readyKey, "1");

      await expect(chunkedFilter.mexistsIfReady(readyKey, lookupItems)).resolves.toEqual([
        true,
        false,
        true,
        false,
        true,
        false,
        true,
      ]);
    } finally {
      await Promise.all([chunkedFilter.delete(), cacheValkeyClient.unlink([readyKey])]);
    }
  });

  it("reports readiness and deletes additional related keys", async () => {
    const readyKey = `test-bloom-ready:${crypto.randomUUID()}`;
    const additionalKey = `test-bloom-extra:${crypto.randomUUID()}`;
    try {
      expect(await filter.isReady(readyKey)).toBe(false);

      await filter.rebuild(["alpha.com"]);
      expect(await filter.isReady(readyKey)).toBe(false);

      await cacheValkeyClient.set(readyKey, "1");
      await cacheValkeyClient.set(additionalKey, "1");
      expect(await filter.isReady(readyKey)).toBe(true);

      await filter.deleteWithAdditionalKeys([readyKey, additionalKey]);
      expect(await filter.keyExists()).toBe(false);
      expect(await cacheValkeyClient.exists([readyKey, additionalKey])).toBe(0);
    } finally {
      await cacheValkeyClient.unlink([readyKey, additionalKey]);
    }
  });
});
