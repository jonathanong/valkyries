import { describe, expect, it, vi } from "vitest";
import { GlideClient, type GlideClient as GlideClientType } from "@valkey/valkey-glide";
import { createChannelPubSub } from "../channel-pubsub.mts";

type MessageCallback = (message: { channel: string | Buffer; message: string | Buffer }) => void;

type FakeClient = {
  publish: ReturnType<typeof vi.fn>;
  punsubscribe: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function createFactory() {
  const clients: FakeClient[] = [];
  let callback: MessageCallback | undefined;
  const createClient = vi.fn(async (config: Parameters<typeof GlideClient.createClient>[0]) => {
    const subscriptions = (config as unknown as Record<string, unknown>).pubsubSubscriptions as
      | { callback: MessageCallback }
      | undefined;
    if (subscriptions) callback = subscriptions.callback;
    const client: FakeClient = {
      publish: vi.fn(async () => undefined),
      punsubscribe: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
    };
    clients.push(client);
    return client as unknown as GlideClientType;
  });

  return {
    clients,
    createClient,
    emit(channel: string | Buffer, message: string | Buffer): void {
      callback?.({ channel, message });
    },
  };
}

function createPubSub<T>(
  factory = createFactory(),
  options?: { closeSubscriberWhenIdle?: boolean },
) {
  return {
    factory,
    pubSub: createChannelPubSub<T>("events", {
      clientConfig: { addresses: [{ host: "localhost", port: 6379 }] },
      createClient: factory.createClient,
      ...options,
    }),
  };
}

describe("createChannelPubSub", () => {
  it("lazily creates independent publish and subscriber clients", async () => {
    const { factory, pubSub } = createPubSub<string>();

    await pubSub.publish("one", "value");
    const subscription = await pubSub.subscribe("one");

    expect(factory.createClient).toHaveBeenCalledTimes(2);
    expect(factory.clients[0]?.publish).toHaveBeenCalledWith('"value"', "events:one");
    expect(factory.clients[1]?.publish).not.toHaveBeenCalled();
    await subscription.close();
  });

  it("uses Glide's factory when no factory is injected", async () => {
    const fakeClient = {
      publish: vi.fn(async () => undefined),
      close: vi.fn(async () => undefined),
      punsubscribe: vi.fn(async () => undefined),
    };
    const createClient = vi
      .spyOn(GlideClient, "createClient")
      .mockResolvedValue(fakeClient as unknown as GlideClientType);
    const pubSub = createChannelPubSub<string>("events", {
      clientConfig: { addresses: [{ host: "localhost", port: 6379 }] },
    });

    try {
      await pubSub.publish("one", "value");
    } finally {
      createClient.mockRestore();
    }

    expect(fakeClient.publish).toHaveBeenCalledWith('"value"', "events:one");
  });

  it("delivers decoded messages to every handler for a key", async () => {
    const { factory, pubSub } = createPubSub<{ value: number }>();
    const first = await pubSub.subscribe("one");
    const second = await pubSub.subscribe("one");
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();
    first.setHandler(firstHandler);
    second.setHandler(secondHandler);

    factory.emit("events:one", '{"value":42}');
    factory.emit("events:two", '{"value":0}');
    factory.emit("other:one", '{"value":0}');

    expect(firstHandler).toHaveBeenCalledExactlyOnceWith({ value: 42 });
    expect(secondHandler).toHaveBeenCalledExactlyOnceWith({ value: 42 });
    await first.close();
    await second.close();
  });

  it("buffers messages until a handler is installed and supports handler replacement", async () => {
    const { factory, pubSub } = createPubSub<string>();
    const subscription = await pubSub.subscribe("one");
    const firstHandler = vi.fn();
    const secondHandler = vi.fn();

    subscription.setHandler(null);
    factory.emit("events:one", '"buffered"');
    subscription.setHandler(firstHandler);
    subscription.setHandler(secondHandler);
    factory.emit("events:one", '"current"');
    subscription.setHandler(null);
    factory.emit("events:one", '"pending-again"');
    const thirdHandler = vi.fn();
    subscription.setHandler(thirdHandler);

    expect(firstHandler).toHaveBeenCalledExactlyOnceWith("buffered");
    expect(secondHandler).toHaveBeenCalledExactlyOnceWith("current");
    expect(thirdHandler).toHaveBeenCalledExactlyOnceWith("pending-again");
    await subscription.close();
  });

  it("isolates buffered handler failures and validates channel parts", async () => {
    const factory = createFactory();
    const onError = vi.fn();
    const pubSub = createChannelPubSub<string>("events", {
      clientConfig: { addresses: [{ host: "localhost", port: 6379 }] },
      createClient: factory.createClient,
      onError,
    });
    const subscription = await pubSub.subscribe("one");
    factory.emit("events:one", '"first"');
    factory.emit("events:one", '"second"');
    const failingHandler = vi.fn(() => {
      throw new Error("buffer handler failed");
    });

    subscription.setHandler(failingHandler);

    expect(failingHandler).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(2);
    await expect(pubSub.subscribe("")).rejects.toThrow("key must be non-empty");
    expect(() =>
      createChannelPubSub<string>("events:*", {
        clientConfig: { addresses: [{ host: "localhost", port: 6379 }] },
      }),
    ).toThrow("prefix must be non-empty");
    await subscription.close();
  });

  it("uses caller-provided codecs and reports decode and handler failures", async () => {
    const factory = createFactory();
    const onError = vi.fn();
    const pubSub = createChannelPubSub<number>("events", {
      clientConfig: { addresses: [{ host: "localhost", port: 6379 }] },
      createClient: factory.createClient,
      serialize: (value) => `value:${value}`,
      deserialize: (value) => {
        if (value === "bad") throw new Error("bad payload");
        return Number(value.slice(6));
      },
      onError,
    });
    const subscription = await pubSub.subscribe("one");
    subscription.setHandler(() => {
      throw new Error("handler failed");
    });

    await pubSub.publish("one", 7);
    factory.emit("events:one", "bad");
    factory.emit("events:one", "value:7");

    expect(factory.clients[1]?.publish).toHaveBeenCalledWith("value:7", "events:one");
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "bad payload" }));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "handler failed" }));
    await subscription.close();
  });

  it("closes an idle subscriber with the configured timeout", async () => {
    const factory = createFactory();
    const pubSub = createChannelPubSub<string>("events", {
      clientConfig: { addresses: [{ host: "localhost", port: 6379 }] },
      createClient: factory.createClient,
      closeSubscriberWhenIdle: true,
      subscriberCloseTimeoutMs: 12,
    });
    const subscription = await pubSub.subscribe("one");
    const secondSubscription = await pubSub.subscribe("one");

    await subscription.close();
    expect(factory.clients[0]?.close).not.toHaveBeenCalled();
    await secondSubscription.close();

    expect(factory.clients[0]?.punsubscribe).toHaveBeenCalledWith(new Set(["events:*"]), 12);
    expect(factory.clients[0]?.close).toHaveBeenCalledTimes(1);
  });

  it("makes subscription and owner shutdown idempotent", async () => {
    const { factory, pubSub } = createPubSub<string>();
    const subscription = await pubSub.subscribe("one");

    await subscription.close();
    await subscription.close();
    subscription.setHandler(vi.fn());
    await pubSub.close();
    await pubSub.close();

    expect(factory.clients[0]?.close).toHaveBeenCalledTimes(1);
    await expect(pubSub.subscribe("two")).rejects.toThrow("closed");
    await expect(pubSub.publish("two", "value")).rejects.toThrow("closed");
  });

  it("retries client creation after publisher and subscriber failures", async () => {
    const factory = createFactory();
    const pubSub = createChannelPubSub<string>("events", {
      clientConfig: { addresses: [{ host: "localhost", port: 6379 }] },
      createClient: factory.createClient,
    });
    factory.createClient.mockRejectedValueOnce(new Error("publisher unavailable"));

    await expect(pubSub.publish("one", "value")).rejects.toThrow("publisher unavailable");
    await pubSub.publish("one", "value");
    factory.createClient.mockRejectedValueOnce(new Error("subscriber unavailable"));

    await expect(pubSub.subscribe("one")).rejects.toThrow("subscriber unavailable");
    const subscription = await pubSub.subscribe("one");

    expect(factory.createClient).toHaveBeenCalledTimes(4);
    await subscription.close();
  });

  it("handles Buffer messages and reports client-close failures", async () => {
    const factory = createFactory();
    const onError = vi.fn();
    const pubSub = createChannelPubSub<string>("events", {
      clientConfig: { addresses: [{ host: "localhost", port: 6379 }] },
      createClient: factory.createClient,
      onError,
    });
    const subscription = await pubSub.subscribe("one");
    const handler = vi.fn();
    subscription.setHandler(handler);
    factory.emit(Buffer.from("events:one"), Buffer.from('"buffered"'));
    factory.clients[0]?.close.mockRejectedValueOnce(new Error("subscriber close failed"));

    await expect(pubSub.closeSubscriber()).rejects.toThrow("subscriptions are active");
    await subscription.close();
    await pubSub.closeSubscriber();

    expect(handler).toHaveBeenCalledExactlyOnceWith("buffered");
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "subscriber close failed" }),
    );
  });

  it("closes the publisher and reports its close failures", async () => {
    const factory = createFactory();
    const onError = vi.fn();
    const pubSub = createChannelPubSub<string>("events", {
      clientConfig: { addresses: [{ host: "localhost", port: 6379 }] },
      createClient: factory.createClient,
      onError,
    });

    await pubSub.closeSubscriber();
    await pubSub.publish("one", "value");
    factory.clients[0]?.close.mockRejectedValueOnce(new Error("publisher close failed"));
    await pubSub.close();

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "publisher close failed" }),
    );
  });
});
