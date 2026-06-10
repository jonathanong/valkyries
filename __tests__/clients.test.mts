import { describe, expect, it, vi, afterEach } from "vitest";
import { GlideClient } from "@valkey/valkey-glide";
import {
  cacheValkeyClient,
  rateLimiterValkeyClient,
  dynamicConfigValkeyClient,
  addPubSubMessageHandler,
  removePubSubMessageHandler,
  ensureDynamicConfigValkeySubscriptionClient,
  closeDynamicConfigValkeySubscriptionClient,
  buildDynamicConfigSubscriptionClientConfig,
} from "../clients.mts";

describe("clients exports and pubsub", () => {
  describe("exported client singletons", () => {
    it("exports cacheValkeyClient as a valid client", () => {
      expect(cacheValkeyClient).toBeDefined();
    });

    it("exports rateLimiterValkeyClient as a valid client", () => {
      expect(rateLimiterValkeyClient).toBeDefined();
    });

    it("exports dynamicConfigValkeyClient as a valid client", () => {
      expect(dynamicConfigValkeyClient).toBeDefined();
    });
  });

  describe("pubsub message handlers", () => {
    afterEach(async () => {
      await closeDynamicConfigValkeySubscriptionClient();
      vi.restoreAllMocks();
    });

    it("addPubSubMessageHandler adds a handler and removes it", () => {
      const handler = vi.fn();
      addPubSubMessageHandler(handler);

      // Extract the callback to call it directly
      const config = buildDynamicConfigSubscriptionClientConfig("redis://localhost:6379");
      const callback = config.pubsubSubscriptions.callback;
      expect(callback).toBeDefined();

      const mockMsg = { channel: "dynamic-config:test", message: "hello" };
      callback(mockMsg);

      expect(handler).toHaveBeenCalledWith(mockMsg);

      removePubSubMessageHandler(handler);
      handler.mockClear();

      const mockMsg2 = { channel: "dynamic-config:test", message: "hello2" };
      callback(mockMsg2);

      expect(handler).not.toHaveBeenCalled();
    });

    it("ensureDynamicConfigValkeySubscriptionClient handles errors and resets promise", async () => {
      const error = new Error("Connection failed");
      vi.spyOn(GlideClient, "createClient").mockRejectedValueOnce(error);

      await expect(ensureDynamicConfigValkeySubscriptionClient()).rejects.toThrow(
        "Connection failed",
      );

      const successClient = {
        punsubscribe: () => vi.fn()(),
        close: () => vi.fn()(),
      } as unknown as GlideClient;
      vi.spyOn(GlideClient, "createClient").mockResolvedValueOnce(successClient);

      const client = await ensureDynamicConfigValkeySubscriptionClient();
      expect(client).toBe(successClient);
    });

    it("closeDynamicConfigValkeySubscriptionClient works safely when called multiple times or when empty", async () => {
      await closeDynamicConfigValkeySubscriptionClient();
      await closeDynamicConfigValkeySubscriptionClient();
      expect(true).toBe(true);

      const client = await ensureDynamicConfigValkeySubscriptionClient();
      expect(client).toBeDefined();
      const client2 = await ensureDynamicConfigValkeySubscriptionClient();
      expect(client).toBe(client2);

      await closeDynamicConfigValkeySubscriptionClient();
    });
  });
});
