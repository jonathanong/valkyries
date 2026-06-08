import { describe, expect, it, vi } from "vitest";
import { GlideClientConfiguration, GlideClient } from "@valkey/valkey-glide";
import {
  buildDynamicConfigSubscriptionClientConfig,
  addPubSubMessageHandler,
  removePubSubMessageHandler,
  ensureDynamicConfigValkeySubscriptionClient,
  closeDynamicConfigValkeySubscriptionClient,
  upsertValkeyClientByUrl,
} from "../clients.mts";

describe("buildDynamicConfigSubscriptionClientConfig", () => {
  it("builds correct config for valid URL", () => {
    const url = "redis://localhost:6379";
    const config = buildDynamicConfigSubscriptionClientConfig(url);

    expect(config.addresses).toEqual([{ host: "localhost", port: 6379 }]);
    expect(config.useTLS).toBe(false);
    expect(config.credentials).toBeUndefined();
    expect(config.readFrom).toBe("preferReplica");
    expect(config.lazyConnect).toBe(false);
    expect(config.inflightRequestsLimit).toBeDefined();
    expect(config.requestTimeout).toBeDefined();

    expect(config.pubsubSubscriptions).toBeDefined();
    expect(config.pubsubSubscriptions?.channelsAndPatterns).toBeDefined();
    expect(
      config.pubsubSubscriptions?.channelsAndPatterns?.[
        GlideClientConfiguration.PubSubChannelModes.Pattern
      ],
    ).toEqual(new Set(["dynamic-config:*"]));

    expect(config.pubsubSubscriptions?.callback).toBeDefined();
    expect(typeof config.pubsubSubscriptions?.callback).toBe("function");
  });

  it("handles valid URLs with credentials", () => {
    const url = "redis://user:password@localhost:6379";
    const config = buildDynamicConfigSubscriptionClientConfig(url);
    expect(config.credentials).toEqual({ username: "user", password: "password" });
  });

  it("handles rediss (TLS) scheme", () => {
    const url = "rediss://localhost:6379";
    const config = buildDynamicConfigSubscriptionClientConfig(url);
    expect(config.useTLS).toBe(true);
  });

  it("throws error for invalid URL", () => {
    expect(() => buildDynamicConfigSubscriptionClientConfig("not-a-url")).toThrow(
      "Invalid Valkey URL: not-a-url",
    );
  });
});

describe("PubSub message handlers", () => {
  it("adds and removes handlers", () => {
    const handler = () => {};
    addPubSubMessageHandler(handler);
    expect(() => removePubSubMessageHandler(handler)).not.toThrow();
  });

  it("callback executes all handlers", () => {
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    addPubSubMessageHandler(handler1);
    addPubSubMessageHandler(handler2);

    const config = buildDynamicConfigSubscriptionClientConfig("redis://localhost:6379");
    config.pubsubSubscriptions!.callback({ channel: "test", message: "test" } as any);

    expect(handler1).toHaveBeenCalled();
    expect(handler2).toHaveBeenCalled();

    removePubSubMessageHandler(handler1);
    removePubSubMessageHandler(handler2);
  });
});

describe("ensureDynamicConfigValkeySubscriptionClient", () => {
  it("creates and caches client", async () => {
    const mockClient = {
      punsubscribe: vi.fn(),
      close: vi.fn()
    };
    vi.spyOn(GlideClient, "createClient").mockResolvedValue(mockClient as any);
    const client1 = await ensureDynamicConfigValkeySubscriptionClient();
    const client2 = await ensureDynamicConfigValkeySubscriptionClient();
    expect(client1).toBe(client2);
    expect(GlideClient.createClient).toHaveBeenCalledTimes(1);

    await closeDynamicConfigValkeySubscriptionClient();
    expect(mockClient.punsubscribe).toHaveBeenCalled();
    expect(mockClient.close).toHaveBeenCalled();

    // Test close again when promise is null
    await closeDynamicConfigValkeySubscriptionClient();
  });

  it("clears promise on error", async () => {
    vi.spyOn(GlideClient, "createClient").mockRejectedValue(new Error("Test error"));
    await expect(ensureDynamicConfigValkeySubscriptionClient()).rejects.toThrow("Test error");
  });
});

describe("upsertValkeyClientByUrl deduplicates concurrent connections", () => {
  it("uses inflight promise", async () => {
    const mockClient = {} as any;
    // Delay resolution so p1 and p2 both hit the in-flight check
    let resolve: any;
    const promise = new Promise((r) => { resolve = r; });
    vi.spyOn(GlideClient, "createClient").mockReturnValue(promise as any);

    const p1 = upsertValkeyClientByUrl("redis://localhost:7380", { lazyConnect: false });
    const p2 = upsertValkeyClientByUrl("redis://localhost:7380", { lazyConnect: false });
    expect(p1).toBeInstanceOf(Promise);
    expect(p2).toBeInstanceOf(Promise);

    resolve(mockClient);

    const r1 = await p1;
    const r2 = await p2;
    expect(r1).toBe(mockClient);
    expect(r2).toBe(mockClient);
  });
});
