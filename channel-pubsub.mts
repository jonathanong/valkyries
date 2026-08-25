import { GlideClient, GlideClientConfiguration, type PubSubMsg } from "@valkey/valkey-glide";
import {
  assertChannelPart,
  decrement,
  deliver,
  glideStringToString,
  removeHandler,
  toError,
} from "./channel-pubsub-internals.mts";

type GlideClientConfig = Parameters<typeof GlideClient.createClient>[0];
type MessageHandler<T> = (value: T) => void;
type PendingSubscription<T> = { buffer: T[] };

export type ChannelSubscription<T> = {
  setHandler(handler: MessageHandler<T> | null): void;
  close(): Promise<void>;
};

export type ChannelPubSub<T> = {
  publish(key: string, value: T): Promise<void>;
  subscribe(key: string): Promise<ChannelSubscription<T>>;
  closeSubscriber(): Promise<void>;
  close(): Promise<void>;
};

export type ChannelPubSubOptions<T> = {
  clientConfig: GlideClientConfig;
  createClient?: (config: GlideClientConfig) => Promise<GlideClient>;
  serialize?: (value: T) => string;
  deserialize?: (value: string) => T;
  closeSubscriberWhenIdle?: boolean;
  subscriberCloseTimeoutMs?: number;
  onError?: (error: Error) => void;
};

const DEFAULT_CLOSE_TIMEOUT_MS = 5_000;

export function createChannelPubSub<T>(
  prefix: string,
  options: ChannelPubSubOptions<T>,
): ChannelPubSub<T> {
  assertChannelPart("prefix", prefix);
  const serialize = options.serialize ?? ((value: T) => JSON.stringify(value));
  const deserialize = options.deserialize ?? ((value: string) => JSON.parse(value) as T);
  const createClient = options.createClient ?? ((config) => GlideClient.createClient(config));
  const closeTimeoutMs = options.subscriberCloseTimeoutMs ?? DEFAULT_CLOSE_TIMEOUT_MS;
  const report = (error: unknown): void => options.onError?.(toError(error));
  const channel = (key: string): string => `${prefix}:${key}`;
  const pattern = `${prefix}:*`;
  const handlers = new Map<string, Set<MessageHandler<T>>>();
  const pending = new Map<string, Set<PendingSubscription<T>>>();
  const counts = new Map<string, number>();
  let publisher: Promise<GlideClient> | undefined;
  let subscriber: Promise<GlideClient> | undefined;
  let closed = false;

  const assertOpen = (): void => {
    if (closed) throw new Error("Channel pub/sub is closed");
  };
  const totalCount = (): number => [...counts.values()].reduce((total, count) => total + count, 0);
  const removePending = (key: string, state: PendingSubscription<T>): void => {
    const states = pending.get(key);
    if (!states) return;
    states.delete(state);
    if (states.size === 0) pending.delete(key);
  };
  const closeClient = async (client: GlideClient): Promise<void> => {
    try {
      await client.punsubscribe(new Set([pattern]), closeTimeoutMs);
    } catch (error) {
      report(error);
    } finally {
      await Promise.resolve(client.close());
    }
  };
  const closeSubscriber = async (): Promise<void> => {
    const current = subscriber;
    subscriber = undefined;
    if (!current) return;
    try {
      await closeClient(await current);
    } catch (error) {
      report(error);
    }
  };
  const closeSubscriberIfIdle = async (): Promise<void> => {
    if (options.closeSubscriberWhenIdle && totalCount() === 0) await closeSubscriber();
  };
  const getPublisher = (): Promise<GlideClient> => {
    publisher ??= createClient(options.clientConfig).catch((error: unknown) => {
      publisher = undefined;
      throw error;
    });
    return publisher;
  };
  const receive = (message: PubSubMsg): void => {
    const raw = glideStringToString(message.message);
    const messageChannel = glideStringToString(message.channel);
    if (!messageChannel.startsWith(`${prefix}:`)) return;
    const key = messageChannel.slice(prefix.length + 1);
    if (!counts.has(key)) return;
    let value: T;
    try {
      value = deserialize(raw);
    } catch (error) {
      report(error);
      return;
    }
    for (const handler of handlers.get(key) ?? []) deliver(handler, value, report);
    for (const state of pending.get(key) ?? []) state.buffer.push(value);
  };
  const getSubscriber = (): Promise<GlideClient> => {
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
    return subscriber;
  };

  return {
    async publish(key, value): Promise<void> {
      assertOpen();
      assertChannelPart("key", key);
      await (await getPublisher()).publish(serialize(value), channel(key));
    },
    async subscribe(key): Promise<ChannelSubscription<T>> {
      assertOpen();
      assertChannelPart("key", key);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const state: PendingSubscription<T> = { buffer: [] };
      let handler: MessageHandler<T> | null = null;
      let subscriptionClosed = false;
      let states = pending.get(key);
      if (!states) pending.set(key, (states = new Set()));
      states.add(state);
      try {
        await getSubscriber();
      } catch (error) {
        removePending(key, state);
        decrement(counts, key);
        await closeSubscriberIfIdle();
        throw error;
      }
      return {
        setHandler(nextHandler): void {
          if (subscriptionClosed) return;
          if (handler) removeHandler(handlers, key, handler);
          handler = nextHandler;
          if (!nextHandler) {
            let waiting = pending.get(key);
            if (!waiting) pending.set(key, (waiting = new Set()));
            waiting.add(state);
            return;
          }
          removePending(key, state);
          let active = handlers.get(key);
          if (!active) handlers.set(key, (active = new Set()));
          active.add(nextHandler);
          for (const value of state.buffer) deliver(nextHandler, value, report);
          state.buffer = [];
        },
        async close(): Promise<void> {
          if (subscriptionClosed) return;
          subscriptionClosed = true;
          removePending(key, state);
          if (handler) removeHandler(handlers, key, handler);
          decrement(counts, key);
          await closeSubscriberIfIdle();
        },
      };
    },
    closeSubscriber,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      await closeSubscriber();
      const current = publisher;
      publisher = undefined;
      if (!current) return;
      try {
        await Promise.resolve((await current).close());
      } catch (error) {
        report(error);
      }
    },
  };
}
