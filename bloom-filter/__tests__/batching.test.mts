import { expect, it, describe } from "vitest";
import { luaBatchSize, chunkItems, concurrentSlices } from "../batching.mts";
import { LUA_UNPACK_BATCH_SIZE } from "../scripts.mts";

describe("batching", () => {
  describe("luaBatchSize", () => {
    it("returns the exact batch size if it is below the limit", () => {
      expect(luaBatchSize(10)).toBe(10);
      expect(luaBatchSize(1)).toBe(1);
    });

    it("returns the limit if the batch size exceeds it", () => {
      expect(luaBatchSize(LUA_UNPACK_BATCH_SIZE + 10)).toBe(LUA_UNPACK_BATCH_SIZE);
      expect(luaBatchSize(LUA_UNPACK_BATCH_SIZE * 2)).toBe(LUA_UNPACK_BATCH_SIZE);
    });

    it("returns exactly the limit if batch size equals the limit", () => {
      expect(luaBatchSize(LUA_UNPACK_BATCH_SIZE)).toBe(LUA_UNPACK_BATCH_SIZE);
    });

    it("handles negative inputs correctly by returning the negative value", () => {
      expect(luaBatchSize(-10)).toBe(-10);
    });

    it("handles zero correctly by returning zero", () => {
      expect(luaBatchSize(0)).toBe(0);
    });
  });

  describe("chunkItems", () => {
    it("returns nothing for empty items", () => {
      const chunks = Array.from(chunkItems([]));
      expect(chunks).toEqual([]);
    });

    it("yields all items as a single chunk if length <= batchSize", () => {
      const items = ["a", "b", "c"];
      const chunks = Array.from(chunkItems(items, 5));
      expect(chunks).toEqual([["a", "b", "c"]]);

      const exactSizeItems = ["a", "b", "c", "d", "e"];
      const exactChunks = Array.from(chunkItems(exactSizeItems, 5));
      expect(exactChunks).toEqual([["a", "b", "c", "d", "e"]]);
    });

    it("splits items into multiple chunks", () => {
      const items = ["a", "b", "c", "d", "e"];
      const chunks = Array.from(chunkItems(items, 2));
      expect(chunks).toEqual([["a", "b"], ["c", "d"], ["e"]]);
    });

    it("uses luaBatchSize by default", () => {
      const items = Array.from({ length: LUA_UNPACK_BATCH_SIZE + 2 }, (_, i) => String(i));
      const chunks = Array.from(chunkItems(items));
      expect(chunks.length).toBe(2);
      expect(chunks[0].length).toBe(LUA_UNPACK_BATCH_SIZE);
      expect(chunks[1].length).toBe(2);
    });
  });

  describe("concurrentSlices", () => {
    it("yields slices with start index", () => {
      const items = ["a", "b", "c", "d", "e"];
      const slices = Array.from(concurrentSlices(items, 2));
      expect(slices).toEqual([
        { start: 0, slice: ["a", "b"] },
        { start: 2, slice: ["c", "d"] },
        { start: 4, slice: ["e"] },
      ]);
    });

    it("returns empty array for empty items", () => {
      const slices = Array.from(concurrentSlices([], 2));
      expect(slices).toEqual([]);
    });

    it("handles concurrency limits larger than items length", () => {
      const items = ["a", "b", "c"];
      const slices = Array.from(concurrentSlices(items, 10));
      expect(slices).toEqual([{ start: 0, slice: ["a", "b", "c"] }]);
    });
  });
});
