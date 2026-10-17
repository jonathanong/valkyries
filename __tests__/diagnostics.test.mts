import { describe, expect, it, vi } from "vitest";
import {
  countKeysByPrefix,
  getValkeyMemoryInfo,
  parseValkeyMemoryInfo,
  validateKeyPrefixRegistry,
} from "../diagnostics.mts";

const BASE = [
  "# Memory",
  "used_memory:100",
  "used_memory_rss:200",
  "used_memory_peak:300",
  "maxmemory:0",
  "maxmemory_policy:noeviction",
];

const info = (...extra: string[]) => [...BASE, ...extra].join("\r\n") + "\r\n";

describe("parseValkeyMemoryInfo", () => {
  it("parses required fields from CRLF input with null optionals", () => {
    expect(parseValkeyMemoryInfo(info("junk line"))).toEqual({
      usedMemoryBytes: 100,
      usedMemoryRssBytes: 200,
      usedMemoryPeakBytes: 300,
      maxmemoryBytes: 0,
      maxmemoryPolicy: "noeviction",
      usedMemoryDatasetBytes: null,
      lazyfreePendingObjects: null,
      memFragmentationRatio: null,
    });
  });

  it("parses optional fields from LF input", () => {
    const text = [
      ...BASE,
      "used_memory_dataset:50",
      "lazyfree_pending_objects:2",
      "mem_fragmentation_ratio:1.5",
    ].join("\n");
    expect(parseValkeyMemoryInfo(text)).toMatchObject({
      usedMemoryDatasetBytes: 50,
      lazyfreePendingObjects: 2,
      memFragmentationRatio: 1.5,
    });
  });

  it.each(BASE.slice(1).map((line) => line.split(":")[0]!))("throws when %s is missing", (name) => {
    const text = BASE.filter((line) => !line.startsWith(`${name}:`)).join("\r\n");
    expect(() => parseValkeyMemoryInfo(text)).toThrow(`INFO field ${name} is missing`);
  });

  it("throws on malformed integers", () => {
    for (const bad of ["-1", "1.5", "abc", "", "9007199254740993"]) {
      const text = info().replace("used_memory:100", `used_memory:${bad}`);
      expect(() => parseValkeyMemoryInfo(text)).toThrow(/used_memory/);
    }
  });

  it("throws on malformed optional fields", () => {
    expect(() => parseValkeyMemoryInfo(info("used_memory_dataset:x"))).toThrow(/non-negative/);
    expect(() => parseValkeyMemoryInfo(info("mem_fragmentation_ratio:-1"))).toThrow(/number/);
    expect(() => parseValkeyMemoryInfo(info("mem_fragmentation_ratio:" + "9".repeat(400)))).toThrow(
      /number/,
    );
  });
});

describe("getValkeyMemoryInfo", () => {
  it("requests the memory section and parses the reply", async () => {
    const client = { info: vi.fn(async () => Buffer.from(info())) };
    const result = await getValkeyMemoryInfo(client as never);
    expect(result.usedMemoryBytes).toBe(100);
    expect(client.info).toHaveBeenCalledWith(["memory"]);
  });

  it("accepts string replies", async () => {
    const client = { info: vi.fn(async () => info()) };
    expect((await getValkeyMemoryInfo(client as never)).maxmemoryPolicy).toBe("noeviction");
  });

  it("aborts before INFO", async () => {
    const client = { info: vi.fn() };
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(
      getValkeyMemoryInfo(client as never, { signal: controller.signal }),
    ).rejects.toThrow("stop");
    expect(client.info).not.toHaveBeenCalled();
  });

  it("aborts after INFO", async () => {
    const controller = new AbortController();
    const client = {
      info: vi.fn(async () => {
        controller.abort(new Error("late"));
        return info();
      }),
    };
    await expect(
      getValkeyMemoryInfo(client as never, { signal: controller.signal }),
    ).rejects.toThrow("late");
  });
});

describe("validateKeyPrefixRegistry", () => {
  it("accepts disjoint and same-group overlapping prefixes", () => {
    expect(() => validateKeyPrefixRegistry({ a: ["a:", "a:b:"], b: ["b:"], c: [] })).not.toThrow();
  });

  it("rejects empty prefixes", () => {
    expect(() => validateKeyPrefixRegistry({ a: [""] })).toThrow(/empty prefix/);
  });

  it("rejects overlaps across groups in either order and identical prefixes", () => {
    expect(() => validateKeyPrefixRegistry({ a: ["a:"], b: ["a:b"] })).toThrow(/overlaps/);
    expect(() => validateKeyPrefixRegistry({ a: ["a:b"], b: ["a:"] })).toThrow(/overlaps/);
    expect(() => validateKeyPrefixRegistry({ a: ["x"], b: ["x"] })).toThrow(/overlaps/);
  });

  it("rejects the reserved group name", () => {
    expect(() => validateKeyPrefixRegistry({ unclassified: ["u:"] })).toThrow(/reserved/);
  });
});

function fakeScan(pages: (string | Buffer)[][], onPage?: (index: number) => void) {
  let index = 0;
  return {
    scan: vi.fn(async () => {
      const page = pages[index]!;
      onPage?.(index);
      index += 1;
      return [index < pages.length ? String(index) : "0", page] as [string, (string | Buffer)[]];
    }),
  };
}

describe("countKeysByPrefix", () => {
  it("counts per group across pages with unclassified keys and Buffer keys", async () => {
    const client = fakeScan([
      ["a:1", Buffer.from("b:1"), "zzz"],
      ["a:2", "b:x"],
    ]);
    const result = await countKeysByPrefix(
      client as never,
      { a: ["a:"], b: ["b:"], empty: [] },
      { count: 10 },
    );
    expect(result).toEqual({ a: 2, b: 2, empty: 0, unclassified: 1 });
    expect(client.scan).toHaveBeenCalledWith("0", expect.objectContaining({ count: 10 }));
  });

  it("defaults count to 500", async () => {
    const client = fakeScan([[]]);
    await countKeysByPrefix(client as never, {});
    expect(client.scan).toHaveBeenCalledWith("0", expect.objectContaining({ count: 500 }));
  });

  it("validates the registry before scanning", async () => {
    const client = fakeScan([[]]);
    await expect(countKeysByPrefix(client as never, { a: [""] })).rejects.toThrow(/empty/);
    expect(client.scan).not.toHaveBeenCalled();
  });

  it("aborts before the first page", async () => {
    const client = fakeScan([[]]);
    const controller = new AbortController();
    controller.abort(new Error("stop"));
    await expect(
      countKeysByPrefix(client as never, {}, { signal: controller.signal }),
    ).rejects.toThrow("stop");
    expect(client.scan).not.toHaveBeenCalled();
  });

  it("aborts between pages", async () => {
    const controller = new AbortController();
    const client = fakeScan([["a:1"], ["a:2"]]);
    const original = client.scan;
    client.scan = vi.fn(async (...args: never[]) => {
      const out = await (original as never as (...a: never[]) => Promise<unknown>)(...args);
      if (original.mock.calls.length === 1) controller.abort(new Error("between"));
      return out;
    }) as never;
    await expect(
      countKeysByPrefix(client as never, { a: ["a:"] }, { signal: controller.signal }),
    ).rejects.toThrow("between");
  });

  it("aborts after the last page", async () => {
    const controller = new AbortController();
    const client = fakeScan([["a:1"]], () => controller.abort(new Error("last")));
    await expect(
      countKeysByPrefix(client as never, { a: ["a:"] }, { signal: controller.signal }),
    ).rejects.toThrow("last");
  });
});
