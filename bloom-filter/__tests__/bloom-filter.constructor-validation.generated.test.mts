import { it, expect, afterEach, beforeEach, describe } from "vitest";
import { ValkeyBloomFilter } from "../../bloom-filter.mts";
import { cacheValkeyClient } from "../../clients.mts";
import { valkeyEvents } from "../../events.mts";
import type { GlideClient } from "@valkey/valkey-glide";

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

  it("ValkeyBloomFilter constructor validates options", () => {
    expect(
      () =>
        new ValkeyBloomFilter({
          name: "",
          capacity: 10_000,
          errorRate: 0.01,
        }),
    ).toThrow("name must be a non-empty string");

    expect(
      () =>
        new ValkeyBloomFilter({
          name: "test",
          capacity: -1,
          errorRate: 0.01,
        }),
    ).toThrow("capacity must be positive");

    expect(
      () =>
        new ValkeyBloomFilter({
          name: "test",
          capacity: 10_000,
          errorRate: 1.5,
        }),
    ).toThrow("errorRate must be between 0 and 1");

    expect(
      () =>
        new ValkeyBloomFilter({
          name: "test",
          capacity: 10_000,
          errorRate: 0.01,
          batchSize: -1,
        }),
    ).toThrow("batchSize must be positive");

    expect(
      () =>
        new ValkeyBloomFilter({
          name: "test",
          capacity: 10_000,
          errorRate: 0.01,
          concurrencyLimit: 0,
        }),
    ).toThrow("concurrencyLimit must be positive");
  });

  it("add honors concurrencyLimit for chunked writes", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const client = {
      invokeScript: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((resolve) => setImmediate(resolve));
        inFlight--;
        return 1;
      },
    };
    const limitedFilter = new ValkeyBloomFilter({
      name: `test-bloom-concurrency-${Math.random().toString(36).slice(2)}`,
      capacity: 100,
      errorRate: 0.01,
      batchSize: 1,
      concurrencyLimit: 2,
      client: client as unknown as GlideClient,
    });

    await limitedFilter.add(["a", "b", "c", "d", "e"]);

    expect(maxInFlight).toBe(2);
  });

  it("normalizes fractional concurrencyLimit to integer chunking", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const client = {
      invokeScript: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((resolve) => setImmediate(resolve));
        inFlight--;
        return 1;
      },
    };
    const limitedFilter = new ValkeyBloomFilter({
      name: `test-bloom-fractional-${Math.random().toString(36).slice(2)}`,
      capacity: 100,
      errorRate: 0.01,
      batchSize: 1,
      concurrencyLimit: 1.5,
      client: client as unknown as GlideClient,
    });

    await limitedFilter.add(["a", "b", "c", "d", "e"]);

    expect(maxInFlight).toBe(1);
  });

  it("exists returns null when filter does not exist", async () => {
    const result = await filter.exists("nonexistent.com");
    expect(result).toBeNull();
  });

  it("keyExists tracks the live filter key lifecycle", async () => {
    expect(await filter.keyExists()).toBe(false);

    await filter.ensureExists();
    expect(await filter.keyExists()).toBe(true);

    await filter.delete();
    expect(await filter.keyExists()).toBe(false);
  });

  it("mexists returns all-null when filter does not exist", async () => {
    const results = await filter.mexists(["a.com", "b.com"]);
    expect(results).toEqual([null, null]);
  });

  it("rebuild and check round-trip", async () => {
    const domains = ["alpha.com", "beta.com", "gamma.com"];
    await filter.rebuild(domains);

    for (const domain of domains) {
      const result = await filter.exists(domain);
      expect(result).toBe(true);
    }

    const notInFilter = await filter.exists("delta.com");
    expect(notInFilter).toBe(false);
  });

  it("rebuild only removes building key, not live key during build", async () => {
    // First build: create live filter
    await filter.rebuild(["initial.com"]);
    expect(await filter.exists("initial.com")).toBe(true);

    // Second rebuild: live key remains accessible throughout
    await filter.rebuild(["new.com", "new2.com"]);

    expect(await filter.exists("new.com")).toBe(true);
    expect(await filter.exists("new2.com")).toBe(true);
  });

  it("rebuild with large number of items uses batching", async () => {
    const items = Array.from({ length: 500 }, (_, i) => `domain-${i}.com`);
    await filter.rebuild(items);

    expect(await filter.exists("domain-0.com")).toBe(true);
    expect(await filter.exists("domain-249.com")).toBe(true);
    expect(await filter.exists("domain-499.com")).toBe(true);
    expect(await filter.exists("nothere.com")).toBe(false);
  });

  it("exists returns false for domain not in filter", async () => {
    await filter.rebuild(["alice.com", "bob.com"]);

    const result = await filter.exists("charlie.com");
    expect(result).toBe(false);
  });

  it("add items to existing filter", async () => {
    await filter.rebuild(["site-a.com"]);

    await filter.add(["site-b.com", "site-c.com"]);

    expect(await filter.exists("site-a.com")).toBe(true);
    expect(await filter.exists("site-b.com")).toBe(true);
    expect(await filter.exists("site-c.com")).toBe(true);
  });

  it("add with empty array does nothing", async () => {
    await filter.rebuild(["initial.com"]);

    await filter.add([]);
    expect(await filter.exists("initial.com")).toBe(true);
  });

  it("rebuildFromStream rebuilds from async iterable of batches", async () => {
    const batches = [["stream-a.com", "stream-b.com"], ["stream-c.com"]];

    async function* batchGen() {
      for (const batch of batches) {
        yield batch;
      }
    }

    await filter.rebuildFromStream(batchGen());

    expect(await filter.exists("stream-a.com")).toBe(true);
    expect(await filter.exists("stream-b.com")).toBe(true);
    expect(await filter.exists("stream-c.com")).toBe(true);
    expect(await filter.exists("nothere.com")).toBe(false);
  });

  it("rebuildFromStream is zero-downtime (live key accessible during build)", async () => {
    await filter.rebuild(["old.com"]);
    expect(await filter.exists("old.com")).toBe(true);

    const newBatches = async function* () {
      yield ["new.com", "new2.com"];
    };

    await filter.rebuildFromStream(newBatches());

    expect(await filter.exists("new.com")).toBe(true);
    expect(await filter.exists("new2.com")).toBe(true);
  });

  it("addStream adds items via async iterable", async () => {
    await filter.rebuild(["initial.com"]);

    const batches = async function* () {
      yield ["stream-1.com", "stream-2.com"];
      yield ["stream-3.com"];
    };

    await filter.addStream(batches());

    expect(await filter.exists("initial.com")).toBe(true);
    expect(await filter.exists("stream-1.com")).toBe(true);
    expect(await filter.exists("stream-2.com")).toBe(true);
    expect(await filter.exists("stream-3.com")).toBe(true);
  });

  it("atomically replaces old filter during rebuild", async () => {
    await filter.rebuild(["old.com"]);
    expect(await filter.exists("old.com")).toBe(true);

    await filter.rebuild(["new.com", "new2.com"]);

    expect(await filter.exists("new.com")).toBe(true);
    expect(await filter.exists("new2.com")).toBe(true);
  });

  it("delete removes the filter", async () => {
    await filter.rebuild(["test.com"]);
    expect(await filter.exists("test.com")).toBe(true);

    await filter.delete();
    expect(await filter.exists("test.com")).toBeNull();
  });

  it("exists returns null on error", async () => {
    const badFilter = new ValkeyBloomFilter({
      name: "test",
      capacity: 10_000,
      errorRate: 0.01,
    });

    await badFilter.delete();

    // Should return null since BF.EXISTS errors on missing key
    const result = await badFilter.exists("any.com");
    expect(result).toBeNull();
  });

  it("getKey and getBuildingKey return correct key names", () => {
    const testFilter = new ValkeyBloomFilter({
      name: "my-filter",
      capacity: 10_000,
      errorRate: 0.01,
    });

    expect(testFilter.getKey()).toBe("bloom-filter:my-filter");
    expect(testFilter.getBuildingKey()).toBe("bloom-filter:my-filter:building");
  });

  it("getConfig returns current configuration", () => {
    const testFilter = new ValkeyBloomFilter({
      name: "my-config",
      capacity: 50_000,
      errorRate: 0.005,
      batchSize: 500,
    });

    const config = testFilter.getConfig();
    expect(config).toEqual({
      name: "my-config",
      capacity: 50_000,
      errorRate: 0.005,
      batchSize: 500,
      concurrencyLimit: 16,
      liveKey: "bloom-filter:my-config",
      buildingKey: "bloom-filter:my-config:building",
    });
  });

  it("multiple filters with different names do not interfere", async () => {
    const suffix = Math.random().toString(36).slice(2);
    const filter1 = new ValkeyBloomFilter({
      name: `filter-1-${suffix}`,
      capacity: 10_000,
      errorRate: 0.01,
    });

    const filter2 = new ValkeyBloomFilter({
      name: `filter-2-${suffix}`,
      capacity: 10_000,
      errorRate: 0.01,
    });

    await filter1.rebuild(["a.com", "b.com"]);
    await filter2.rebuild(["x.com", "y.com"]);

    expect(await filter1.exists("a.com")).toBe(true);
    expect(await filter1.exists("x.com")).toBe(false);

    expect(await filter2.exists("x.com")).toBe(true);
    expect(await filter2.exists("a.com")).toBe(false);

    await filter1.delete();
    await filter2.delete();
  });

  it("rebuild with empty array creates empty filter", async () => {
    await filter.rebuild([]);

    // Filter exists but has no items
    expect(await filter.exists("anything.com")).toBe(false);
  });

  it("add() dual-writes to buildingKey during active rebuild, surviving rename", async () => {
    // Verifies the bloom-filter-add.lua dual-write: items added via add() while
    // rebuildFromStream is in progress must survive the atomic buildingKey→liveKey rename.
    await filter.ensureExists();

    // Simulate an in-progress rebuild by creating the building key
    const buildingKey = filter.getBuildingKey();
    await cacheValkeyClient.customCommand([
      "BF.RESERVE",
      buildingKey,
      "0.01",
      "10000",
      "EXPANSION",
      "2",
    ]);

    try {
      // add() Lua script checks EXISTS buildingKey and writes to both
      await filter.add(["concurrent.com"]);

      // Item is in the live filter
      expect(await filter.exists("concurrent.com")).toBe(true);

      // Simulate rebuild completing: rename building → live (overwrites live filter)
      await cacheValkeyClient.rename(buildingKey, filter.getKey());

      // Item must survive — because add() also wrote it to buildingKey
      expect(await filter.exists("concurrent.com")).toBe(true);
    } finally {
      await cacheValkeyClient.unlink([buildingKey]);
    }
  });

  it("addStream() dual-writes to buildingKey during active rebuild, surviving rename", async () => {
    await filter.ensureExists();

    const buildingKey = filter.getBuildingKey();
    await cacheValkeyClient.customCommand([
      "BF.RESERVE",
      buildingKey,
      "0.01",
      "10000",
      "EXPANSION",
      "2",
    ]);

    try {
      const batches = async function* () {
        yield ["streamed.com"];
      };

      await filter.addStream(batches());

      expect(await filter.exists("streamed.com")).toBe(true);

      // Simulate rebuild completing: rename building → live (overwrites live filter)
      await cacheValkeyClient.rename(buildingKey, filter.getKey());

      // Item must survive — because addStream() also wrote it to buildingKey
      expect(await filter.exists("streamed.com")).toBe(true);
    } finally {
      await cacheValkeyClient.unlink([buildingKey]);
    }
  });

  it("add with large batch of items", async () => {
    await filter.rebuild(["initial.com"]);

    const largeItems = Array.from({ length: 1000 }, (_, i) => `domain-${i}.com`);
    await filter.add(largeItems);

    expect(await filter.exists("domain-0.com")).toBe(true);
    expect(await filter.exists("domain-500.com")).toBe(true);
    expect(await filter.exists("domain-999.com")).toBe(true);
  });

  it("ensureExists creates filter when it does not exist", async () => {
    // Filter doesn't exist yet
    expect(await filter.exists("test.com")).toBeNull();

    await filter.ensureExists();

    // After ensureExists, the filter exists and items can be checked (returns false, not null)
    expect(await filter.exists("test.com")).toBe(false);
  });

  it("ensureExists is idempotent when filter already exists", async () => {
    await filter.ensureExists();
    // Second call should not throw even though filter already exists
    await expect(filter.ensureExists()).resolves.toBeUndefined();

    // Filter is still usable
    expect(await filter.exists("test.com")).toBe(false);
  });

  it("mexists returns correct results for mix of present and absent items", async () => {
    const domains = ["present-a.com", "present-b.com"];
    await filter.rebuild(domains);

    const results = await filter.mexists(["present-a.com", "absent.com", "present-b.com"]);
    expect(results[0]).toBe(true);
    expect(results[1]).toBe(false);
    expect(results[2]).toBe(true);
  });

  it("ValkeyBloomFilter.addStream emits one bloom-filter:add event per batch", async () => {
    const testFilter = new ValkeyBloomFilter({
      name: `test-addstream-${Math.random().toString(36).slice(2)}`,
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

      const batches = async function* () {
        yield ["stream-a.com", "stream-b.com"];
        yield ["stream-c.com"];
      };

      await testFilter.addStream(batches());
      // addStream emits one event per batch chunk
      expect(addEvents).toHaveLength(2);
      expect(addEvents[0]!.name).toBe(filterName);
      expect(addEvents[0]!.items).toEqual(["stream-a.com", "stream-b.com"]);
      expect(addEvents[1]!.name).toBe(filterName);
      expect(addEvents[1]!.items).toEqual(["stream-c.com"]);
    } finally {
      valkeyEvents.off("bloom-filter:add", handler);
      await testFilter.delete();
    }
  });
});
