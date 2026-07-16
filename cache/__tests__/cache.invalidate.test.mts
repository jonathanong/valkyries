import { describe, expect, it, vi } from "vitest";
import type { GlideClient } from "@valkey/valkey-glide";
import { ValkeyCache } from "../../cache.mts";
import { valkeyEvents } from "../../events.mts";

describe("ValkeyCache.invalidateMany", () => {
  it("scans once and invalidates each unique literal cache prefix", async () => {
    const scan = vi
      .fn()
      .mockResolvedValueOnce([
        "0",
        ["cache:users:1", "cache:users:invalidation:{1}", "cache:topics:1", "cache:other:1"],
      ]);
    const unlink = vi.fn().mockResolvedValueOnce(3);
    const client = { scan, unlink } as unknown as GlideClient;
    const invalidated: string[] = [];
    const handler = ({ cacheName }: { cacheName: string }) => invalidated.push(cacheName);
    valkeyEvents.on("cache:invalidate", handler);

    try {
      const prefixes = ["users", null, "topics", undefined, "users"] as unknown as string[];
      await ValkeyCache.invalidateMany(prefixes, client);
    } finally {
      valkeyEvents.off("cache:invalidate", handler);
    }

    expect(scan).toHaveBeenCalledOnce();
    expect(scan).toHaveBeenCalledWith("0", { match: "cache:*", count: 500 });
    expect(unlink).toHaveBeenCalledWith([
      "cache:users:1",
      "cache:users:invalidation:{1}",
      "cache:topics:1",
    ]);
    expect(invalidated).toEqual(["users", "topics"]);
  });

  it("does nothing when no valid string prefixes are supplied", async () => {
    const scan = vi.fn();
    const unlink = vi.fn();
    const client = { scan, unlink } as unknown as GlideClient;
    const prefixes = [null, undefined, 42] as unknown as string[];

    await ValkeyCache.invalidateMany(prefixes, client);

    expect(scan).not.toHaveBeenCalled();
    expect(unlink).not.toHaveBeenCalled();
  });

  it("treats an empty prefix as all cache namespaces", async () => {
    const scan = vi
      .fn()
      .mockResolvedValueOnce(["0", ["cache:users:1", "cache:topics:1", "rate-limit:users:1"]]);
    const unlink = vi.fn().mockResolvedValueOnce(2);
    const client = { scan, unlink } as unknown as GlideClient;

    await ValkeyCache.invalidateMany([""], client);

    expect(unlink).toHaveBeenCalledWith(["cache:users:1", "cache:topics:1"]);
  });

  it("invalidates multiple cache instances without deleting other namespaces", async () => {
    const suffix = Math.random().toString(36).slice(2);
    const first = new ValkeyCache({ prefix: `invalidate-many-first-${suffix}`, ttlSeconds: 60 });
    const second = new ValkeyCache({ prefix: `invalidate-many-second-${suffix}`, ttlSeconds: 60 });
    const other = new ValkeyCache({ prefix: `invalidate-many-other-${suffix}`, ttlSeconds: 60 });

    try {
      await Promise.all([
        first.set("key", { cache: "first" }),
        second.set("key", { cache: "second" }),
        other.set("key", { cache: "other" }),
      ]);

      await ValkeyCache.invalidateMany([first.prefix, second.prefix]);

      await expect(first.get("key")).resolves.toBeNull();
      await expect(second.get("key")).resolves.toBeNull();
      await expect(other.get("key")).resolves.toEqual({ cache: "other" });
    } finally {
      await Promise.all([first.delete("key"), second.delete("key"), other.delete("key")]);
    }
  });
});
