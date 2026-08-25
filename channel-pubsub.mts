import { GlideClient, GlideClientConfiguration, type PubSubMsg } from "@valkey/valkey-glide";
import {
  assertChannelPart,
  closeSubscriberClient,
  decrement,
  deliver,
  getOrCreateSet,
  glideStringToString,
  removePending,
  removeHandler,
  reportError,
  serializeForPublish,
} from "./channel-pubsub-internals.mts";
import type {
  ChannelPubSub,
  ChannelPubSubHandler,
  ChannelPubSubOptions,
  ChannelSubscription,
} from "./channel-pubsub-types.mts";

export type {
  ChannelPubSub,
  ChannelPubSubOptions,
  ChannelSubscription,
} from "./channel-pubsub-types.mts";

export function createChannelPubSub<T>(
  prefix: string,
  options: ChannelPubSubOptions<T>,
): ChannelPubSub<T> {
  assertChannelPart("prefix", prefix);
  if (options.clientConfig.pubsubSubscriptions) {
    throw new Error("clientConfig cannot include pubsubSubscriptions");
  }
  const closeTimeoutMs = options.subscriberCloseTimeoutMs ?? 5_000;
  if (!Number.isSafeInteger(closeTimeoutMs) || closeTimeoutMs <= 0) {
    throw new Error("subscriberCloseTimeoutMs must be a positive safe integer");
  }
  const report = (error: unknown): void => reportError(options.onError, error);
  const serialize = options.serialize ?? ((value: T) => JSON.stringify(value));
  const deserialize = options.deserialize ?? ((value: string) => JSON.parse(value) as T);
  const createClient = options.createClient ?? ((config) => GlideClient.createClient(config));
  const pattern = `${prefix}:*`;
  const handlers = new Map<string, Set<{ handler: ChannelPubSubHandler<T> }>>();
  const pending = new Map<string, Set<{ buffer: T[] }>>();
  const counts = new Map<string, number>();
  let publisher: Promise<GlideClient> | undefined;
  let subscriber: Promise<GlideClient> | undefined;
  let subscriberClose: Promise<void> | undefined;
  let ownerClose: Promise<void> | undefined;
  let closed = false;

  const assertOpen = (): void => {
    if (closed) throw new Error("Channel pub/sub is closed");
  };
  const totalCount = (): number => [...counts.values()].reduce((total, count) => total + count, 0);
  const shutdownSubscriber = (): Promise<void> => {
    if (subscriberClose) return subscriberClose;
    const current = subscriber;
    subscriber = undefined;
    if (!current) return Promise.resolve();
    const closePromise = (async (): Promise<void> => {
      try {
        await closeSubscriberClient(await current, pattern, closeTimeoutMs, report);
      } catch (error) {
        report(error);
      }
    })();
    subscriberClose = closePromise;
    void closePromise.finally(() => {
      subscriberClose = undefined;
    });
    return closePromise;
  };
  const closeSubscriberIfIdle = (): Promise<void> => {
    return options.closeSubscriberWhenIdle && totalCount() === 0
      ? shutdownSubscriber()
      : Promise.resolve();
  };
  const getPublisher = (): Promise<GlideClient> => {
    publisher ??= createClient(options.clientConfig).catch((error: unknown) => {
      publisher = undefined;
      throw error;
    });
    return publisher;
  };
  const receive = (message: PubSubMsg): void => {
    const messageChannel = glideStringToString(message.channel);
    if (!messageChannel.startsWith(`${prefix}:`)) return;
    const key = messageChannel.slice(prefix.length + 1);
    if (!counts.has(key)) return;
    let value: T;
    try {
      value = deserialize(glideStringToString(message.message));
    } catch (error) {
      report(error);
      return;
    }
    const currentHandlers = new Set(handlers.get(key));
    for (const entry of currentHandlers) deliver(entry.handler, value, report);
    for (const state of pending.get(key) ?? []) state.buffer.push(value);
  };
  const getSubscriber = async (): Promise<GlideClient> => {
    if (subscriberClose) await subscriberClose;
    assertOpen();
    subscriber ??= createClient({
      ...options.clientConfig,
      pubsubSubscriptions: {
        channelsAndPatterns: {
          [GlideClientConfiguration.PubSubChannelModes.Pattern]: new Set([pattern]),
        },
        callback: receive,
        context: undefined,
      },
    }).catch((error: unknown) => {
      subscriber = undefined;
      throw error;
    });
    return await subscriber;
  };

  return {
    async publish(key, value): Promise<void> {
      assertOpen();
      assertChannelPart("key", key);
      await (
        await getPublisher()
      ).publish(serializeForPublish(serialize, value, report), `${prefix}:${key}`);
    },
    async subscribe(key): Promise<ChannelSubscription<T>> {
      assertOpen();
      assertChannelPart("key", key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const state = { buffer: [] as T[] };
      let handler: { handler: ChannelPubSubHandler<T> } | undefined;
      let closePromise: Promise<void> | undefined;
      getOrCreateSet(pending, key).add(state);
      const rollback = async (): Promise<void> => {
        removePending(pending, key, state);
        if (handler) removeHandler(handlers, key, handler);
        decrement(counts, key);
        await closeSubscriberIfIdle();
      };
      try {
        await getSubscriber();
        if (closed) throw new Error("Channel pub/sub is closed");
      } catch (error) {
        await rollback();
        throw error;
      }
      return {
        setHandler(nextHandler): void {
          if (closePromise) return;
          if (handler) removeHandler(handlers, key, handler);
          if (!nextHandler) {
            handler = undefined;
            getOrCreateSet(pending, key).add(state);
            return;
          }
          removePending(pending, key, state);
          handler = { handler: nextHandler };
          getOrCreateSet(handlers, key).add(handler);
          for (const value of state.buffer) deliver(nextHandler, value, report);
          state.buffer = [];
        },
        close(): Promise<void> {
          closePromise ??= rollback();
          return closePromise;
        },
      };
    },
    closeSubscriber(): Promise<void> {
      if (totalCount() > 0) {
        return Promise.reject(new Error("Cannot close subscriber while subscriptions are active"));
      }
      return shutdownSubscriber();
    },
    close(): Promise<void> {
      if (ownerClose) return ownerClose;
      closed = true;
      ownerClose = (async (): Promise<void> => {
        await shutdownSubscriber();
        const current = publisher;
        publisher = undefined;
        if (!current) return;
        try {
          await Promise.resolve((await current).close());
        } catch (error) {
          report(error);
        }
      })();
      return ownerClose;
    },
  };
}
