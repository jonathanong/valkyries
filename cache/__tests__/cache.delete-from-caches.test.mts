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
    const key = "delete-from-caches-shared-key";
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

  it("waits for all started deletes before rejecting", async () => {
    let resolveSecond!: (count: number) => void;
    const secondPromise = new Promise<number>((resolve) => {
      resolveSecond = resolve;
    });
    const firstInvokeScript = vi
      .fn<GlideClient["invokeScript"]>()
      .mockRejectedValue(new Error("first client failed"));
    const secondInvokeScript = vi.fn<GlideClient["invokeScript"]>().mockReturnValue(secondPromise);
    const firstClient = { invokeScript: firstInvokeScript } as unknown as GlideClient;
    const secondClient = { invokeScript: secondInvokeScript } as unknown as GlideClient;
    const first = new ValkeyCache({
      prefix: "first-client-delete-error",
      ttlSeconds: 30,
      client: firstClient,
    });
    const second = new ValkeyCache({
      prefix: "second-client-delete-error",
      ttlSeconds: 30,
      client: secondClient,
    });

    let rejected = false;
    const deletePromise = ValkeyCache.deleteFromCaches([
      { cache: first, keys: ["a"] },
      { cache: second, keys: ["b"] },
    ]).catch((error) => {
      rejected = true;
      return error;
    });

    await Promise.resolve();
    expect(rejected).toBe(false);

    resolveSecond(1);
    const error = await deletePromise;
    expect(rejected).toBe(true);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("first client failed");
  });

  it("rejects when a started delete fails with null", async () => {
    let resolveSecond!: (count: number) => void;
    const secondPromise = new Promise<number>((resolve) => {
      resolveSecond = resolve;
    });
    const firstInvokeScript = vi.fn<GlideClient["invokeScript"]>().mockRejectedValue(null);
    const secondInvokeScript = vi.fn<GlideClient["invokeScript"]>().mockReturnValue(secondPromise);
    const firstClient = { invokeScript: firstInvokeScript } as unknown as GlideClient;
    const secondClient = { invokeScript: secondInvokeScript } as unknown as GlideClient;
    const first = new ValkeyCache({
      prefix: "first-client-delete-null-error",
      ttlSeconds: 30,
      client: firstClient,
    });
    const second = new ValkeyCache({
      prefix: "second-client-delete-null-error",
      ttlSeconds: 30,
      client: secondClient,
    });

    const deletePromise = ValkeyCache.deleteFromCaches([
      { cache: first, keys: ["a"] },
      { cache: second, keys: ["b"] },
    ]);
    let settled = false;
    deletePromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await Promise.resolve();
    expect(settled).toBe(false);

    resolveSecond(1);
    await expect(deletePromise).rejects.toBeNull();
    expect(settled).toBe(true);
  });
});
