import { expect, it, describe } from "vitest";
import { LUA_UNPACK_BATCH_SIZE, ValkeyBloomFilter } from "../../bloom-filter.mts";
import { valkeyEvents } from "../../events.mts";

describe("bloom-filter-lua-batch", () => {
  it("addOrThrow() clamps large Lua batches to the safe unpack size", async () => {
    const filter = makeChunkedFilter("add");
    try {
      await filter.ensureExists();
      const items = Array.from(
        { length: LUA_UNPACK_BATCH_SIZE + 1 },
        (_, i) => `lua-safe-add-${i}`,
      );

      await filter.addOrThrow(items);

      expect(await filter.exists("lua-safe-add-0")).toBe(true);
      expect(await filter.exists(`lua-safe-add-${LUA_UNPACK_BATCH_SIZE}`)).toBe(true);
    } finally {
      await filter.delete();
    }
  });

  it("addStream() splits incoming batches larger than the safe Lua unpack size", async () => {
    const filter = makeChunkedFilter("stream");
    try {
      await filter.ensureExists();

      await filter.addStream(batches("lua-safe-stream"));

      expect(await filter.exists("lua-safe-stream-0")).toBe(true);
      expect(await filter.exists(`lua-safe-stream-${LUA_UNPACK_BATCH_SIZE}`)).toBe(true);
    } finally {
      await filter.delete();
    }
  });

  it("rebuild() uses the configured batch size for native commands", async () => {
    const filter = makeChunkedFilter("rebuild");
    const items = Array.from(
      { length: LUA_UNPACK_BATCH_SIZE + 1 },
      (_, i) => `native-rebuild-${i}`,
    );
    const eventSizes: number[] = [];
    const handler = (data: { name: string; items: string[] }) => {
      if (data.name === filter.getConfig().name) eventSizes.push(data.items.length);
    };
    valkeyEvents.on("bloom-filter:add", handler);
    try {
      await filter.rebuild(items);

      expect(eventSizes).toEqual([items.length]);
      expect(await filter.exists("native-rebuild-0")).toBe(true);
      expect(await filter.exists(`native-rebuild-${LUA_UNPACK_BATCH_SIZE}`)).toBe(true);
    } finally {
      valkeyEvents.off("bloom-filter:add", handler);
      await filter.delete();
    }
  });

  function makeChunkedFilter(suffix: string) {
    return new ValkeyBloomFilter({
      name: `test-lua-safe-${suffix}-${Math.random().toString(36).slice(2)}`,
      capacity: 20_000,
      errorRate: 0.01,
      batchSize: LUA_UNPACK_BATCH_SIZE + 1_000,
    });
  }

  async function* batches(prefix: string) {
    yield Array.from({ length: LUA_UNPACK_BATCH_SIZE + 1 }, (_, i) => `${prefix}-${i}`);
  }
});
