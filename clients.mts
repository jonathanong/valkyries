import { setTimeout as sleep } from "node:timers/promises";
import {
  ALL_PATTERNS,
  GlideClient,
  GlideClientConfiguration,
  type PubSubMsg,
} from "@valkey/valkey-glide";
import { config } from "./config.mts";
import { handleValkeyError, ValkeyUrlError } from "./errors.mts";

const CLIENT_CLOSE_SETTLE_MS = 100;

export type ValkeyReadFrom = "primary" | "preferReplica";

export type ValkeyClientOptions = {
  readFrom?: ValkeyReadFrom;
  lazyConnect?: boolean;
};

export const urlsToClients = new Map<string, GlideClient>();
const urlsToClientPromises = new Map<string, Promise<GlideClient>>();

export const cacheValkeyClient = await upsertValkeyClientByUrl(config.cache_url, {
  readFrom: "preferReplica",
});
export const rateLimiterValkeyClient = await upsertValkeyClientByUrl(config.rate_limiter_url, {
  readFrom: "primary",
});
export const dynamicConfigValkeyClient = await upsertValkeyClientByUrl(config.dynamic_config_url, {
  readFrom: "preferReplica",
});

let dynamicConfigValkeySubscriptionClientPromise: Promise<GlideClient> | null = null;

type PubSubMessageHandler = (msg: PubSubMsg) => void;
const pubSubMessageHandlers = new Set<PubSubMessageHandler>();

export function addPubSubMessageHandler(handler: PubSubMessageHandler): void {
  pubSubMessageHandlers.add(handler);
}

export function removePubSubMessageHandler(handler: PubSubMessageHandler): void {
  pubSubMessageHandlers.delete(handler);
}

export function ensureDynamicConfigValkeySubscriptionClient(): Promise<GlideClient> {
  if (dynamicConfigValkeySubscriptionClientPromise)
    return dynamicConfigValkeySubscriptionClientPromise;

  const clientPromise = GlideClient.createClient(
    buildDynamicConfigSubscriptionClientConfig(config.dynamic_config_url),
  ).catch((error) => {
    dynamicConfigValkeySubscriptionClientPromise = null;
    handleValkeyError(error);
    throw error;
  });

  dynamicConfigValkeySubscriptionClientPromise = clientPromise;
  return clientPromise;
}

export async function closeDynamicConfigValkeySubscriptionClient(): Promise<void> {
  const clientPromise = dynamicConfigValkeySubscriptionClientPromise;
  if (!clientPromise) return;

  dynamicConfigValkeySubscriptionClientPromise = null;
  const client = await clientPromise;
  await client.punsubscribe(ALL_PATTERNS, 5_000);
  client.close();
  await sleep(CLIENT_CLOSE_SETTLE_MS);
}

function handlePubSubMessage(msg: PubSubMsg): void {
  for (const handler of pubSubMessageHandlers) handler(msg);
}

export async function upsertValkeyClientByUrl(
  url: string,
  options?: ValkeyClientOptions,
): Promise<GlideClient> {
  const effectiveLazyConnect = options?.lazyConnect ?? true;
  const cacheKey = `${url}:${options?.readFrom ?? "default"}:${effectiveLazyConnect}`;
  const existing = urlsToClients.get(cacheKey);
  if (existing) return existing;
  const inFlight = urlsToClientPromises.get(cacheKey);
  if (inFlight) return inFlight;
  const clientPromise = GlideClient.createClient(glideConfigFromUrl(url, options))
    .then((client) => {
      urlsToClients.set(cacheKey, client);
      return client;
    })
    .finally(() => {
      urlsToClientPromises.delete(cacheKey);
    });
  urlsToClientPromises.set(cacheKey, clientPromise);
  return await clientPromise;
}

export function glideConfigFromUrl(url: string, options?: ValkeyClientOptions) {
  try {
    const parsed = new URL(url);

    return {
      addresses: [
        {
          host: parsed.hostname,
          port: parsed.port ? Number(parsed.port) : 6379,
        },
      ],
      useTLS: parsed.protocol === "rediss:",
      credentials: parsed.password
        ? {
            ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
            password: decodeURIComponent(parsed.password),
          }
        : undefined,
      readFrom: options?.readFrom,
      lazyConnect: options?.lazyConnect ?? true,
    };
  } catch (cause) {
    throw new ValkeyUrlError("Invalid Valkey URL", { cause });
  }
}

export function buildDynamicConfigSubscriptionClientConfig(url: string) {
  return {
    ...glideConfigFromUrl(url, { readFrom: "preferReplica", lazyConnect: false }),
    pubsubSubscriptions: {
      channelsAndPatterns: {
        [GlideClientConfiguration.PubSubChannelModes.Pattern]: new Set(["dynamic-config:*"]),
      },
      callback: handlePubSubMessage,
    },
  };
}
