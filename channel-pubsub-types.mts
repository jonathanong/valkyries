import type { GlideClient } from "@valkey/valkey-glide";

type GlideClientConfig = Parameters<typeof GlideClient.createClient>[0];
export type ChannelPubSubHandler<T> = (value: T) => void;

export type ChannelSubscription<T> = {
  setHandler(handler: ChannelPubSubHandler<T> | null): void;
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
