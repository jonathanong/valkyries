import { describe, expect, it, vi } from "vitest";
import type { GlideClient } from "@valkey/valkey-glide";
import { createChannelPubSub } from "../channel-pubsub.mts";

type FakeClient = {
  publish: ReturnType<typeof vi.fn>;
  punsubscribe: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function createClient(overrides: Partial<FakeClient> = {}): FakeClient {
  return {
    publish: vi.fn(async () => undefined),
    punsubscribe: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve: resolve! };
}

const config = { addresses: [{ host: "localhost", port: 6379 }] };

describe("channel pub/sub lifecycle", () => {
  it("coalesces concurrent subscription and owner closes until cleanup settles", async () => {
    const subscriberClose = deferred<void>();
    const publisherClose = deferred<void>();
    const subscriber = createClient({
      punsubscribe: vi.fn(() => subscriberClose.promise),
    });
    const publisher = createClient({ close: vi.fn(() => publisherClose.promise) });
    const createClientFn = vi
      .fn<() => Promise<GlideClient>>()
      .mockResolvedValueOnce(subscriber as unknown as GlideClient)
      .mockResolvedValueOnce(publisher as unknown as GlideClient);
    const pubSub = createChannelPubSub<string>("events", {
      clientConfig: config,
      createClient: createClientFn,
      closeSubscriberWhenIdle: true,
    });
    const subscription = await pubSub.subscribe("one");

    const subscriptionClose = subscription.close();
    expect(subscription.close()).toBe(subscriptionClose);
    const subscriberOwnerClose = pubSub.closeSubscriber();
    await vi.waitFor(() => expect(subscriber.punsubscribe).toHaveBeenCalledTimes(1));
    subscriberClose.resolve();
    await subscriptionClose;
    await subscriberOwnerClose;

    await pubSub.publish("one", "value");
    const ownerClose = pubSub.close();
    expect(pubSub.close()).toBe(ownerClose);
    await vi.waitFor(() => expect(publisher.close).toHaveBeenCalledTimes(1));
    publisherClose.resolve();
    await ownerClose;
  });

  it("rolls back a subscription that races owner shutdown", async () => {
    const pendingClient = deferred<GlideClient>();
    const createClientFn = vi.fn(() => pendingClient.promise);
    const pubSub = createChannelPubSub<string>("events", {
      clientConfig: config,
      createClient: createClientFn,
    });
    const subscribing = pubSub.subscribe("one");
    const closing = pubSub.close();
    const subscriber = createClient();
    pendingClient.resolve(subscriber as unknown as GlideClient);

    await expect(subscribing).rejects.toThrow("closed");
    await closing;
    expect(subscriber.close).toHaveBeenCalledTimes(1);
  });

  it("waits for an idle subscriber close before opening the next subscriber", async () => {
    const firstClose = deferred<void>();
    const first = createClient({ punsubscribe: vi.fn(() => firstClose.promise) });
    const second = createClient();
    const createClientFn = vi
      .fn<() => Promise<GlideClient>>()
      .mockResolvedValueOnce(first as unknown as GlideClient)
      .mockResolvedValueOnce(second as unknown as GlideClient);
    const pubSub = createChannelPubSub<string>("events", {
      clientConfig: config,
      createClient: createClientFn,
      closeSubscriberWhenIdle: true,
    });
    const firstSubscription = await pubSub.subscribe("one");
    const firstSubscriptionClose = firstSubscription.close();
    const secondSubscription = pubSub.subscribe("two");

    expect(createClientFn).toHaveBeenCalledTimes(1);
    firstClose.resolve();
    await firstSubscriptionClose;
    const nextSubscription = await secondSubscription;

    expect(createClientFn).toHaveBeenCalledTimes(2);
    await nextSubscription.close();
  });

  it("does not create a replacement subscriber after owner close while waiting", async () => {
    const firstClose = deferred<void>();
    const first = createClient({ punsubscribe: vi.fn(() => firstClose.promise) });
    const createClientFn = vi
      .fn<() => Promise<GlideClient>>()
      .mockResolvedValue(first as unknown as GlideClient);
    const pubSub = createChannelPubSub<string>("events", {
      clientConfig: config,
      createClient: createClientFn,
      closeSubscriberWhenIdle: true,
    });
    const firstSubscription = await pubSub.subscribe("one");
    const firstSubscriptionClose = firstSubscription.close();
    const subscribing = pubSub.subscribe("two");
    const closing = pubSub.close();

    firstClose.resolve();
    await firstSubscriptionClose;
    await expect(subscribing).rejects.toThrow("closed");
    await closing;
    expect(createClientFn).toHaveBeenCalledTimes(1);
  });

  it("keeps callback identity per subscription and snapshots handler delivery", async () => {
    let callback: ((message: { channel: string; message: string }) => void) | undefined;
    const client = createClient();
    const createClientFn = vi.fn(async (options: Record<string, unknown>) => {
      callback = (options.pubsubSubscriptions as { callback: typeof callback }).callback;
      return client as unknown as GlideClient;
    });
    const pubSub = createChannelPubSub<string>("events", {
      clientConfig: config,
      createClient: createClientFn as never,
    });
    const first = await pubSub.subscribe("one");
    const second = await pubSub.subscribe("one");
    const shared = vi.fn();
    first.setHandler(shared);
    second.setHandler(shared);

    callback?.({ channel: "events:one", message: '"shared"' });
    await first.close();
    callback?.({ channel: "events:one", message: '"remaining"' });

    expect(shared).toHaveBeenNthCalledWith(1, "shared");
    expect(shared).toHaveBeenNthCalledWith(2, "shared");
    expect(shared).toHaveBeenNthCalledWith(3, "remaining");

    const replacement = vi.fn();
    const original = vi.fn();
    second.setHandler((value) => {
      second.setHandler(replacement);
      original(value);
    });
    callback?.({ channel: "events:one", message: '"current"' });
    callback?.({ channel: "events:one", message: '"next"' });

    expect(original).toHaveBeenCalledExactlyOnceWith("current");
    expect(replacement).toHaveBeenCalledExactlyOnceWith("next");
    await second.close();
  });

  it("reports serializer failures while rejecting publish", async () => {
    const onError = vi.fn();
    const pubSub = createChannelPubSub<string>("events", {
      clientConfig: config,
      createClient: vi.fn(async () => createClient() as unknown as GlideClient),
      serialize: () => {
        throw new Error("serialize failed");
      },
      onError,
    });

    await expect(pubSub.publish("one", "value")).rejects.toThrow("serialize failed");
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "serialize failed" }));
  });

  it("contains a subscriber connection failure during owner shutdown", async () => {
    const pendingClient = deferred<GlideClient>();
    const onError = vi.fn();
    const pubSub = createChannelPubSub<string>("events", {
      clientConfig: config,
      createClient: vi.fn(() => pendingClient.promise),
      onError,
    });
    const subscribing = pubSub.subscribe("one");
    const closing = pubSub.close();
    pendingClient.resolve(Promise.reject(new Error("subscriber failed")) as never);

    await expect(subscribing).rejects.toThrow("subscriber failed");
    await closing;
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "subscriber failed" }));
  });

  it("contains errors thrown by onError during delivery and cleanup", async () => {
    let callback: ((message: { channel: string; message: string }) => void) | undefined;
    const subscriber = createClient({
      punsubscribe: vi.fn(async () => {
        throw new Error("unsubscribe failed");
      }),
    });
    const createClientFn = vi.fn(async (options: Record<string, unknown>) => {
      callback = (options.pubsubSubscriptions as { callback: typeof callback }).callback;
      return subscriber as unknown as GlideClient;
    });
    const pubSub = createChannelPubSub<string>("events", {
      clientConfig: config,
      createClient: createClientFn as never,
      onError: () => {
        throw new Error("reporter failed");
      },
    });
    const subscription = await pubSub.subscribe("one");
    subscription.setHandler(() => {
      throw new Error("handler failed");
    });

    expect(() => callback?.({ channel: "events:one", message: '"value"' })).not.toThrow();
    await subscription.close();
    await expect(pubSub.closeSubscriber()).resolves.toBeUndefined();
  });

  it("rejects unsafe client subscription config and invalid close timeouts", () => {
    expect(() =>
      createChannelPubSub<string>("events", {
        clientConfig: { ...config, pubsubSubscriptions: {} } as never,
      }),
    ).toThrow("cannot include pubsubSubscriptions");
    for (const subscriberCloseTimeoutMs of [0, -1, 1.5, Number.POSITIVE_INFINITY]) {
      expect(() =>
        createChannelPubSub<string>("events", { clientConfig: config, subscriberCloseTimeoutMs }),
      ).toThrow("positive safe integer");
    }
  });
});
