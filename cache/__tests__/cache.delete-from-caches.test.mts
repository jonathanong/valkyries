import type { GlideClient } from "@valkey/valkey-glide";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cacheValkeyClient } from "../../clients.mts";
import { valkeyEvents } from "../../events.mts";
import { ValkeyCache } from "../../cache.mts";

describe("ValkeyCache.deleteFromCaches", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deletes entries from multiple same-client caches with one script call", async () => {
    const key = `delete-from-caches-${Math.random().toString(36).slice(2)}`;
    const first = new ValkeyCache({ prefix: "delete-from-caches-a", ttlSeconds: 30 });
    const second = new ValkeyCache({ prefix: "delete-from-caches-b", ttlSeconds: 30 });

    await first.set(key, { value: "first" });
    await second.set(key, { value: "second" });
    const invokeScriptSpy = vi.spyOn(cacheValkeyClient, "invokeScript");

    const deleted = await ValkeyCache.deleteFromCaches([
      { cache: first, keys: [key] },
      { cache: second, keys: [key] },
    ]);

    expect(deleted).toBe(2);
    expect(invokeScriptSpy).toHaveBeenCalledTimes(1);
    expect(await first.get(key)).toBeNull();
    expect(await second.get(key)).toBeNull();
  });

  it("filters invalid keys, honors each cache serializer, and emits per-cache delete events", async () => {
    const invokeScript = vi.fn<GlideClient["invokeScript"]>().mockResolvedValue(2);
    const client = { invokeScript } as unknown as GlideClient;
    const events: unknown[] = [];
    const handler = (event: unknown): void => {
      events.push(event);
    };
    valkeyEvents.on("cache:delete", handler);
    try {
      const numeric = new ValkeyCache<number>({
        prefix: "numeric-delete",
        ttlSeconds: 30,
        client,
        keySerializer: (key) => ` numeric:${key} `,
      });
      const text = new ValkeyCache<string>({ prefix: "text-delete", ttlSeconds: 30, client });

      const deleted = await ValkeyCache.deleteFromCaches([
        { cache: numeric, keys: [7] },
        { cache: text, keys: [" MixedCase ", ""] },
      ]);

      expect(deleted).toBe(2);
      expect(invokeScript).toHaveBeenCalledTimes(1);
      expect(invokeScript.mock.calls[0]?.[1]).toMatchObject({
        keys: [
          "cache:numeric-delete:{numeric:7}",
          "cache:text-delete:{mixedcase}",
          "cache:numeric-delete:invalidation:{numeric:7}",
          "cache:text-delete:invalidation:{mixedcase}",
        ],
        args: ["2", "60"],
      });
      expect(events).toEqual([
        { cacheName: "numeric-delete", keys: ["numeric:7"] },
        { cacheName: "text-delete", keys: ["mixedcase"] },
      ]);
    } finally {
      valkeyEvents.off("cache:delete", handler);
    }
  });

  it("groups delete scripts by Valkey client", async () => {
    const firstInvokeScript = vi.fn<GlideClient["invokeScript"]>().mockResolvedValue(1);
    const secondInvokeScript = vi.fn<GlideClient["invokeScript"]>().mockResolvedValue(1);
    const firstClient = { invokeScript: firstInvokeScript } as unknown as GlideClient;
    const secondClient = { invokeScript: secondInvokeScript } as unknown as GlideClient;
    const first = new ValkeyCache({
      prefix: "first-client-delete",
      ttlSeconds: 30,
      client: firstClient,
    });
    const second = new ValkeyCache({
      prefix: "second-client-delete",
      ttlSeconds: 30,
      client: secondClient,
    });

    const deleted = await ValkeyCache.deleteFromCaches([
      { cache: first, keys: ["a"] },
      { cache: second, keys: ["b"] },
    ]);

    expect(deleted).toBe(2);
    expect(firstInvokeScript).toHaveBeenCalledTimes(1);
    expect(secondInvokeScript).toHaveBeenCalledTimes(1);
  });
});
