import { describe, expect, it, vi, afterEach } from "vitest";
import { GlideClient } from "@valkey/valkey-glide";
import { setValkeyErrorHandler } from "../errors.mts";
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
      setValkeyErrorHandler(() => {});
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

    it("removePubSubMessageHandler explicitly removes a specific handler without affecting others", () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      addPubSubMessageHandler(handler1);
      addPubSubMessageHandler(handler2);

      removePubSubMessageHandler(handler1);

      const config = buildDynamicConfigSubscriptionClientConfig("redis://localhost:6379");
      const callback = config.pubsubSubscriptions.callback;
      const mockMsg = { channel: "dynamic-config:test", message: "hello" };
      callback(mockMsg);

      expect(handler1).not.toHaveBeenCalled();
      expect(handler2).toHaveBeenCalledWith(mockMsg);

      removePubSubMessageHandler(handler2);
    });

    it("removePubSubMessageHandler safely handles removing a non-existent handler", () => {
      const handler = vi.fn();
      expect(() => removePubSubMessageHandler(handler)).not.toThrow();
    });

    it("ensureDynamicConfigValkeySubscriptionClient handles errors and resets promise", async () => {
      const handleError = vi.fn();
      setValkeyErrorHandler(handleError);
      const error = new Error("Connection failed");
      const createClientSpy = vi.spyOn(GlideClient, "createClient").mockRejectedValueOnce(error);

      await expect(ensureDynamicConfigValkeySubscriptionClient()).rejects.toThrow(
        "Connection failed",
      );

      expect(handleError).toHaveBeenCalledTimes(1);
      expect(handleError).toHaveBeenCalledWith(error);

      const successClient = {
        punsubscribe: vi.fn(),
        close: vi.fn(),
      } as unknown as GlideClient;
      createClientSpy.mockResolvedValueOnce(successClient);

      const client = await ensureDynamicConfigValkeySubscriptionClient();
      expect(client).toBe(successClient);

      // The second call to ensureDynamicConfigValkeySubscriptionClient returns the already cached promise.
      const client2 = await ensureDynamicConfigValkeySubscriptionClient();
      expect(client2).toBe(successClient);

      expect(createClientSpy).toHaveBeenCalledTimes(2);
    });

    it("closeDynamicConfigValkeySubscriptionClient works safely when called multiple times or when empty", async () => {
      await closeDynamicConfigValkeySubscriptionClient();
      await closeDynamicConfigValkeySubscriptionClient();
      expect(true).toBe(true);

      const punsubscribe = vi.fn();
      const close = vi.fn();
      const mockClient = { punsubscribe, close } as unknown as GlideClient;
      vi.spyOn(GlideClient, "createClient").mockResolvedValue(mockClient);

      const client = await ensureDynamicConfigValkeySubscriptionClient();
      expect(client).toBe(mockClient);
      const client2 = await ensureDynamicConfigValkeySubscriptionClient();
      expect(client).toBe(client2);

      await closeDynamicConfigValkeySubscriptionClient();
      expect(punsubscribe).toHaveBeenCalled();
      expect(close).toHaveBeenCalled();
    });
  });
});
