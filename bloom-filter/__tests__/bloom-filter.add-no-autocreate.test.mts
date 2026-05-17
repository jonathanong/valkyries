import { it, expect, afterEach, beforeEach, describe } from "vitest";
import { ValkeyBloomFilter } from "../../bloom-filter.mts";
import { cacheValkeyClient } from "../../clients.mts";

// Regression tests for #1955 — add() must not auto-create an empty/under-provisioned
// bloom filter when the live key is absent. An auto-created empty filter causes BF.EXISTS
// to return 0 for all keys, which ValkeyCache interprets as "definitely doesn't exist"
// and returns null — producing 404s for real entities during the backfill window.
describe("bloom-filter.add-no-autocreate", () => {
  let filter: ValkeyBloomFilter;

  beforeEach(() => {
    filter = new ValkeyBloomFilter({
      name: `test-no-autocreate-${Math.random().toString(36).slice(2)}`,
      capacity: 10_000,
      errorRate: 0.01,
    });
  });

  afterEach(async () => {
    await filter.delete();
  });

  it("add() does not auto-create the live bloom filter (regression for #1955)", async () => {
    // Before the fix, BF.MADD would auto-create the live key with Valkey server defaults
    // (capacity=100) if it did not exist. An empty/under-provisioned filter causes BF.EXISTS
    // to return 0 for all keys, which the cache layer interpreted as "definitely doesn't exist"
    // and returned null — causing 404s for real entities during the backfill window.
    await filter.delete(); // ensure filter is absent

    await filter.add(["item1", "item2"]);

    // The live filter must still not exist — add() should be a no-op when live is absent
    const result = await filter.exists("item1");
    expect(result).toBeNull(); // null = filter key doesn't exist; false would be a bloom miss
  });

  it("addStream() does not auto-create the live bloom filter (regression for #1955)", async () => {
    await filter.delete();

    await filter.addStream(
      (async function* () {
        yield ["item1", "item2"];
      })(),
    );

    const result = await filter.exists("item1");
    expect(result).toBeNull();
  });

  it("add() writes to buildingKey when building exists but live does not (regression for #1955)", async () => {
    // During an active rebuildFromStream the building key is reserved but the live key may
    // not yet exist. add() must write to building so newly created entities are included in
    // the swapped-in filter after RENAME.
    await filter.delete();

    // Manually reserve only the building key — simulates mid-rebuild state
    const buildingKey = filter.getBuildingKey();
    await cacheValkeyClient.customCommand([
      "BF.RESERVE",
      buildingKey,
      "0.01",
      "100",
      "EXPANSION",
      "2",
    ]);

    await filter.add(["item1"]);

    // Live must still be absent
    const liveResult = await filter.exists("item1");
    expect(liveResult).toBeNull();

    // Building must have the item
    const buildingResult = await cacheValkeyClient.customCommand([
      "BF.EXISTS",
      buildingKey,
      "item1",
    ]);
    expect(buildingResult).toBe(1);
  });
});
