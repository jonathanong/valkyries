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
const SUBSCRIPTION_RETRY_BASE_DELAY_MS = 1_000;
const SUBSCRIPTION_RETRY_MAX_DELAY_MS = 5_000;

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

export const SUBSCRIPTION_WARNING_TYPE = "ValkeySubscriptionWarning";

// Recoverable subscription problems are warnings so a retried attempt never reaches the
// application's error handler; only the final failure does.
function warnSubscription(message: string): void {
  process.emitWarning(message, { type: SUBSCRIPTION_WARNING_TYPE });
}

function errorMessage(error: unknown): string {
  try {
    return String(error instanceof Error ? error.message : error);
  } catch {
    // e.g. Object.create(null) or a throwing/Symbol message; never let formatting abort a retry.
    return "An unknown error occurred";
  }
}

export function ensureDynamicConfigValkeySubscriptionClient(): Promise<GlideClient> {
  if (dynamicConfigValkeySubscriptionClientPromise)
    return dynamicConfigValkeySubscriptionClientPromise;

  const attempts = config.subscription_creation_attempts;
  const isCurrent = () => dynamicConfigValkeySubscriptionClientPromise === clientPromise;
  const clientPromise: Promise<GlideClient> = (async () => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await createSubscriptionClientAttempt(attempt, attempts);
      } catch (error) {
        // A detached attempt belongs to shutdown, which reports its rejection itself.
        if (!isCurrent()) throw error;
        if (attempt >= attempts) {
          reportSubscriptionError(error);
          throw error;
        }
        const backoffMs = Math.min(
          SUBSCRIPTION_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1),
          SUBSCRIPTION_RETRY_MAX_DELAY_MS,
        );
        warnSubscription(`${errorMessage(error)}; retrying in ${backoffMs} ms`);
        await delay(backoffMs);
        if (!isCurrent()) throw error;
      }
    }
  })().catch((error: unknown) => {
    if (isCurrent()) dynamicConfigValkeySubscriptionClientPromise = null;
    throw error;
  });

  dynamicConfigValkeySubscriptionClientPromise = clientPromise;
  return clientPromise;
}

function createSubscriptionClientAttempt(attempt: number, attempts: number): Promise<GlideClient> {
  const timeoutMs = config.subscription_creation_timeout_ms;
  const startedAt = Date.now();
  let expired = false;
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      expired = true;
      // A fire time well past timeoutMs points at event-loop starvation rather than a native stall.
      reject(
        new Error(
          `DynamicConfig subscription client creation timed out after ${timeoutMs} ms ` +
            `(attempt ${attempt}/${attempts}, deadline fired after ${Date.now() - startedAt} ms)`,
        ),
      );
    }, timeoutMs);
  });
  const creation = Promise.resolve()
    .then(() =>
      GlideClient.createClient(
        buildDynamicConfigSubscriptionClientConfig(config.dynamic_config_url),
      ),
    )
    .then((client) => {
      if (expired) {
        warnSubscription(
          `DynamicConfig subscription client creation finished after ` +
            `${Date.now() - startedAt} ms, past its ${timeoutMs} ms deadline ` +
            `(attempt ${attempt}/${attempts}); closing the late client`,
        );
        client.close();
      }
      return client;
    });
  // Observe late native rejection/close failure after the deadline has already won.
  creation.catch((error) => {
    if (expired) {
      warnSubscription(
        `DynamicConfig subscription client attempt ${attempt}/${attempts} failed after its ` +
          `deadline: ${errorMessage(error)}`,
      );
    }
  });
  return Promise.race([creation, deadline]).finally(() => clearTimeout(timer));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
