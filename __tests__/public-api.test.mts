import { describe, expect, it, vi } from "vitest";
import * as api from "../index.mts";
import { setValkeyErrorHandler, handleValkeyError } from "../errors.mts";
import { emitValkeyEvent, valkeyEvents } from "../events.mts";
import { normalizeKey } from "../key-normalization.mts";
import * as channelPubSub from "../channel-pubsub.mts";

describe("public api", () => {
  it("exports the package surface", () => {
    expect(api.ValkeyCache).toBeTypeOf("function");
    expect(Reflect.get(api.ValkeyCache, "deleteFromCaches")).toBeTypeOf("function");
    expect(Reflect.get(api.ValkeyCache, "invalidateMany")).toBeTypeOf("function");
    expect(api.ValkeyBloomFilter).toBeTypeOf("function");
    expect(api.DynamicConfig).toBeTypeOf("function");
    expect(api.RateLimiter).toBeTypeOf("function");
    expect(api.getAndDelete).toBeTypeOf("function");
    expect(api.reserveIdempotencyKey).toBeTypeOf("function");
    expect(api.completeIdempotencyKey).toBeTypeOf("function");
    expect(api.releaseIdempotencyKey).toBeTypeOf("function");
    expect(api.unlinkIfValueMatches).toBeTypeOf("function");
    expect(api.closeValkeyClients).toBeTypeOf("function");
    expect(api.isRetryableValkeyError).toBeTypeOf("function");
    expect(api.retryValkeyOperation).toBeTypeOf("function");
    expect(api.registerScript).toBeTypeOf("function");
    expect(api.loadScript).toBeTypeOf("function");
    expect(api.urlsToClients).toBeInstanceOf(Map);
    expect(api.multiCacheGetByAnyBatch).toBeTypeOf("function");
    expect(api.scanAndUnlinkKeys).toBeTypeOf("function");
    expect(api).not.toHaveProperty("deleteKeysWithPrefix");
    expect(api).not.toHaveProperty("deleteKeysWithLiteralPrefixes");
    expect(api.expireKeysWithNoExpiry).toBeTypeOf("function");
    expect(api).not.toHaveProperty("createChannelPubSub");
    expect(channelPubSub.createChannelPubSub).toBeTypeOf("function");
  });

  it("normalizes keys", () => {
    expect(normalizeKey("  AbC  ")).toBe("abc");
  });

  it("uses the configured error handler", () => {
    const handler = vi.fn();
    setValkeyErrorHandler(handler);

    handleValkeyError("boom");

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect(handler.mock.calls[0]![0].message).toBe("boom");
  });

  it("routes event handler failures to the configured error handler", () => {
    const errorHandler = vi.fn();
    const eventHandler = vi.fn(() => {
      throw new Error("handler failed");
    });
    setValkeyErrorHandler(errorHandler);
    valkeyEvents.on("cache:hit", eventHandler);
    try {
      emitValkeyEvent("cache:hit", { cacheName: "test", keys: ["a"], count: 1 });
    } finally {
      valkeyEvents.off("cache:hit", eventHandler);
    }

    expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
  });
});
