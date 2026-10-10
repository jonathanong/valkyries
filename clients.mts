import { setTimeout as sleep } from "node:timers/promises";
import {
  ALL_PATTERNS,
  GlideClient,
  GlideClientConfiguration,
  type PubSubMsg,
} from "@valkey/valkey-glide";
import { config } from "./config.mts";
import { handleValkeyError } from "./errors.mts";

const CLIENT_CLOSE_SETTLE_MS = 100;
const SUBSCRIPTION_CONNECTION_TIMEOUT_MS = 2_000;
const SUBSCRIPTION_CREATION_TIMEOUT_MS = 5_000;

export type ValkeyReadFrom = "primary" | "preferReplica";

export type ValkeyClientOptions = {
  name?: string;
  readFrom?: ValkeyReadFrom;
  lazyConnect?: boolean;
  inflightRequestsLimit?: number;
  requestTimeout?: number;
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

function reportSubscriptionError(error: unknown): void {
  try {
    handleValkeyError(error);
  } catch (cause) {
    // Error reporting must not replace the native failure or reject an ignored observer.
    process.emitWarning(
      new AggregateError([error, cause], "DynamicConfig subscription error handler threw", {
        cause,
      }),
    );
  }
}

export function ensureDynamicConfigValkeySubscriptionClient(): Promise<GlideClient> {
  if (dynamicConfigValkeySubscriptionClientPromise)
    return dynamicConfigValkeySubscriptionClientPromise;

  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      reject(new Error("DynamicConfig subscription client creation timed out after 5000 ms"));
    }, SUBSCRIPTION_CREATION_TIMEOUT_MS);
  });
  const creation = Promise.resolve()
    .then(() =>
      GlideClient.createClient(
        buildDynamicConfigSubscriptionClientConfig(config.dynamic_config_url),
      ),
    )
    .then((client) => {
      if (expired) client.close();
      return client;
    });
  // Observe late native rejection/close failure after the deadline has already won.
  creation.catch((error) => {
    if (expired) reportSubscriptionError(error);
  });
  const clientPromise = Promise.race([creation, deadline])
    .catch((error) => {
      if (dynamicConfigValkeySubscriptionClientPromise === clientPromise)
        dynamicConfigValkeySubscriptionClientPromise = null;
      reportSubscriptionError(error);
      throw error;
    })
    .finally(() => clearTimeout(timer));

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
  const effectiveInflight = options?.inflightRequestsLimit ?? config.inflight_requests_limit;
  const effectiveTimeout = options?.requestTimeout ?? config.request_timeout_ms;
  const cacheKey = [
    url,
    options?.readFrom ?? "default",
    effectiveLazyConnect,
    effectiveInflight,
    effectiveTimeout,
    options?.name ?? "",
  ].join(":");
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
      inflightRequestsLimit: options?.inflightRequestsLimit ?? config.inflight_requests_limit,
      requestTimeout: options?.requestTimeout ?? config.request_timeout_ms,
    };
  } catch (cause) {
    throw new Error(`Invalid Valkey URL: ${url}`, { cause });
  }
}

export function buildDynamicConfigSubscriptionClientConfig(url: string) {
  return {
    ...glideConfigFromUrl(url, { readFrom: "preferReplica", lazyConnect: false }),
    advancedConfiguration: { connectionTimeout: SUBSCRIPTION_CONNECTION_TIMEOUT_MS },
    pubsubSubscriptions: {
      channelsAndPatterns: {
        [GlideClientConfiguration.PubSubChannelModes.Pattern]: new Set(["dynamic-config:*"]),
      },
      callback: handlePubSubMessage,
    },
  };
}
