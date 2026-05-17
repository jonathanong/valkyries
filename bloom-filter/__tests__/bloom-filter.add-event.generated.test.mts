import { it, expect, afterEach, beforeEach, describe } from "vitest";
import {
  ValkeyBloomFilter,
  normalizeBloomCheckResult,
  isBloomMissingKeyError,
} from "../../bloom-filter.mts";
import { cacheValkeyClient } from "../../clients.mts";
import { valkeyEvents } from "../../events.mts";

describe("bloom-filter.generated", () => {
  let filter: ValkeyBloomFilter;

  beforeEach(() => {
    filter = new ValkeyBloomFilter({
      name: `test-bloom-${Math.random().toString(36).slice(2)}`,
      capacity: 10_000,
      errorRate: 0.01,
      batchSize: 100,
    });
  });

  afterEach(async () => {
    await filter.delete();
  });

  it("ValkeyBloomFilter emits bloom-filter:add event", async () => {
    const testFilter = new ValkeyBloomFilter({
      name: `test-add-${Math.random().toString(36).slice(2)}`,
      capacity: 10_000,
      errorRate: 0.01,
    });

    const filterName = testFilter.getConfig().name;
    const addEvents: { name: string; items: string[] }[] = [];
    const handler = (data: { name: string; items: string[] }) => {
      if (data.name === filterName) addEvents.push(data);
    };
    valkeyEvents.on("bloom-filter:add", handler);
    try {
      await testFilter.ensureExists();
      await testFilter.add(["item1", "item2", "item3"]);
      expect(addEvents).toHaveLength(1);
      expect(addEvents[0]!.name).toBe(filterName);
      expect(addEvents[0]!.items).toEqual(["item1", "item2", "item3"]);
    } finally {
      valkeyEvents.off("bloom-filter:add", handler);
      await testFilter.delete();
    }
  });

  it("ValkeyBloomFilter emits bloom-filter:exists event", async () => {
    const testFilter = new ValkeyBloomFilter({
      name: `test-exists-${Math.random().toString(36).slice(2)}`,
      capacity: 10_000,
      errorRate: 0.01,
    });

    await testFilter.ensureExists();
    await testFilter.add(["test-item"]);

    const filterName = testFilter.getConfig().name;
    const existsEvents: { name: string; item: string; result: boolean | null }[] = [];
    const handler = (data: { name: string; item: string; result: boolean | null }) => {
      if (data.name === filterName) existsEvents.push(data);
    };
    valkeyEvents.on("bloom-filter:exists", handler);
    try {
      const result = await testFilter.exists("test-item");
      expect(result).toBe(true);
      expect(existsEvents).toHaveLength(1);
      expect(existsEvents[0]!.name).toBe(filterName);
      expect(existsEvents[0]!.item).toBe("test-item");
      expect(existsEvents[0]!.result).toBe(true);
    } finally {
      valkeyEvents.off("bloom-filter:exists", handler);
      await testFilter.delete();
    }
  });

  it("normalizeBloomCheckResult returns true for 1, 1n, true", () => {
    expect(normalizeBloomCheckResult(1)).toBe(true);
    expect(normalizeBloomCheckResult(1n)).toBe(true);
    expect(normalizeBloomCheckResult(true)).toBe(true);
  });

  it("normalizeBloomCheckResult returns false for 0, 0n, false", () => {
    expect(normalizeBloomCheckResult(0)).toBe(false);
    expect(normalizeBloomCheckResult(0n)).toBe(false);
    expect(normalizeBloomCheckResult(false)).toBe(false);
  });

  it("normalizeBloomCheckResult returns null for null, undefined, -1, -1n, and unknown values", () => {
    expect(normalizeBloomCheckResult(null)).toBe(null);
    expect(normalizeBloomCheckResult(undefined)).toBe(null);
    expect(normalizeBloomCheckResult(-1)).toBe(null);
    expect(normalizeBloomCheckResult(-1n)).toBe(null);
    expect(normalizeBloomCheckResult("yes")).toBe(null);
    expect(normalizeBloomCheckResult(2)).toBe(null);
  });

  it('isBloomMissingKeyError matches "does not exist" BF.MADD failures', () => {
    expect(
      isBloomMissingKeyError(
        new Error("ERR operation BF.MADD failed because key does not exist for this filter"),
      ),
    ).toBe(true);
  });

  it('isBloomMissingKeyError matches "not found", "missing", "no such key" BF.MADD failures', () => {
    expect(isBloomMissingKeyError(new Error("ERR BF.MADD key not found"))).toBe(true);
    expect(isBloomMissingKeyError(new Error("ERR BF.MADD filter is missing"))).toBe(true);
    expect(isBloomMissingKeyError(new Error("ERR BF.MADD no such key"))).toBe(true);
  });

  it("add() with items exceeding batchSize uses chunking loop", async () => {
    const chunkedFilter = new ValkeyBloomFilter({
      name: `test-chunked-${Math.random().toString(36).slice(2)}`,
      capacity: 10_000,
      errorRate: 0.01,
      batchSize: 50,
    });
    try {
      await chunkedFilter.ensureExists();
      // 120 items with batchSize=50 → 3 chunks (50+50+20)
      const items = Array.from({ length: 120 }, (_, i) => `chunk-item-${i}`);
      await chunkedFilter.add(items);

      expect(await chunkedFilter.exists("chunk-item-0")).toBe(true);
      expect(await chunkedFilter.exists("chunk-item-49")).toBe(true);
      expect(await chunkedFilter.exists("chunk-item-50")).toBe(true);
      expect(await chunkedFilter.exists("chunk-item-99")).toBe(true);
      expect(await chunkedFilter.exists("chunk-item-100")).toBe(true);
      expect(await chunkedFilter.exists("chunk-item-119")).toBe(true);
      expect(await chunkedFilter.exists("not-added")).toBe(false);
    } finally {
      await chunkedFilter.delete();
    }
  });

  it("rebuildFromStream cleans up building key on error", async () => {
    await filter.ensureExists();

    async function* failingStream(): AsyncIterable<string[]> {
      yield ["ok-item"];
      throw new Error("stream error");
    }

    await expect(filter.rebuildFromStream(failingStream())).rejects.toThrow("stream error");

    // Building key should be cleaned up after error
    const buildingKeyExists = await cacheValkeyClient.customCommand([
      "EXISTS",
      filter.getBuildingKey(),
    ]);
    expect(buildingKeyExists).toBe(0);
  });

  it("rebuildFromStream with custom capacity override", async () => {
    const customFilter = new ValkeyBloomFilter({
      name: `test-custom-cap-${Math.random().toString(36).slice(2)}`,
      capacity: 100,
      errorRate: 0.01,
    });
    try {
      const items = async function* () {
        yield ["item-a", "item-b"];
      };
      // Rebuild with capacity override much larger than default
      await customFilter.rebuildFromStream(items(), 50_000);

      expect(await customFilter.exists("item-a")).toBe(true);
      expect(await customFilter.exists("item-b")).toBe(true);
      expect(await customFilter.exists("item-c")).toBe(false);
    } finally {
      await customFilter.delete();
    }
  });

  it("isBloomMissingKeyError ignores unrelated BF.MADD errors and non-BF.MADD errors", () => {
    expect(isBloomMissingKeyError(new Error("ERR BF.MADD invalid key format"))).toBe(false);
    expect(isBloomMissingKeyError(new Error("ERR key does not exist"))).toBe(false);
    expect(isBloomMissingKeyError("BF.MADD key does not exist")).toBe(false);
    expect(isBloomMissingKeyError(null)).toBe(false);
  });

  it("ValkeyBloomFilter emits bloom-filter:mexists event", async () => {
    const testFilter = new ValkeyBloomFilter({
      name: `test-mexists-${Math.random().toString(36).slice(2)}`,
      capacity: 10_000,
      errorRate: 0.01,
    });

    await testFilter.rebuild(["item-a", "item-b"]);

    const filterName = testFilter.getConfig().name;
    const mexistsEvents: { name: string; items: string[]; results: (boolean | null)[] }[] = [];
    const handler = (data: { name: string; items: string[]; results: (boolean | null)[] }) => {
      if (data.name === filterName) mexistsEvents.push(data);
    };
    valkeyEvents.on("bloom-filter:mexists", handler);
    try {
      const results = await testFilter.mexists(["item-a", "absent-item", "item-b"]);
      expect(results[0]).toBe(true);
      expect(results[1]).toBe(false);
      expect(results[2]).toBe(true);
      expect(mexistsEvents).toHaveLength(1);
      expect(mexistsEvents[0]!.name).toBe(filterName);
      expect(mexistsEvents[0]!.items).toEqual(["item-a", "absent-item", "item-b"]);
      expect(mexistsEvents[0]!.results).toEqual([true, false, true]);
    } finally {
      valkeyEvents.off("bloom-filter:mexists", handler);
      await testFilter.delete();
    }
  });
});
