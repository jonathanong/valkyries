# Clients

The package exports default clients for simple applications:

- `cacheValkeyClient`
- `rateLimiterValkeyClient`
- `dynamicConfigValkeyClient`

Connections are deduplicated by URL, read preference, and lazy-connect setting through `upsertValkeyClientByUrl()`.

For libraries, tests, and multi-tenant services, pass a `GlideClient` directly to `ValkeyCache`, `ValkeyBloomFilter`, `DynamicConfig`, or `RateLimiter`.

Use `closeValkeyClients()` or `onGracefulShutdown()` to close package-managed clients and the dynamic-config pub/sub connection.

## Default Clients

```ts
import { cacheValkeyClient, rateLimiterValkeyClient, dynamicConfigValkeyClient } from "valkyries";
```

Default clients are created at module load:

- `cacheValkeyClient`: uses `VALKEY_CACHE_URL` or `VALKEY_URL`, reads from replicas when possible.
- `rateLimiterValkeyClient`: uses `VALKEY_RATE_LIMITER_URL`, `VALKEY_CACHE_URL`, or `VALKEY_URL`, and reads from primary.
- `dynamicConfigValkeyClient`: uses `VALKEY_DYNAMIC_CONFIG_URL` or `VALKEY_URL`, reads from replicas when possible.

## `ValkeyClientOptions`

```ts
type ValkeyClientOptions = {
  readFrom?: "primary" | "preferReplica";
  lazyConnect?: boolean;
  inflightRequestsLimit?: number;
  requestTimeout?: number;
};
```

| Option                  | Default         | Env var                          | Description                                                |
| ----------------------- | --------------- | -------------------------------- | ---------------------------------------------------------- |
| `readFrom`              | (Glide default) | —                                | Read preference: `"primary"` or `"preferReplica"`.         |
| `lazyConnect`           | `true`          | —                                | Whether Glide connects lazily on first command.            |
| `inflightRequestsLimit` | `1000`          | `VALKEY_INFLIGHT_REQUESTS_LIMIT` | Maximum number of concurrent inflight requests per client. |
| `requestTimeout`        | `500`           | `VALKEY_REQUEST_TIMEOUT_MS`      | Per-request timeout in milliseconds.                       |

## `urlsToClients`

```ts
const urlsToClients: Map<string, GlideClient>;
```

Registry of package-managed clients keyed by URL, read preference, lazy-connect, inflight-requests limit, and request timeout.

## `upsertValkeyClientByUrl(url, options?)`

```ts
upsertValkeyClientByUrl(
  url: string,
  options?: ValkeyClientOptions,
): Promise<GlideClient>
```

Returns an existing matching client or creates and stores a new one.

## `glideConfigFromUrl(url, options?)`

```ts
glideConfigFromUrl(url: string, options?: ValkeyClientOptions)
```

Builds a Glide client configuration from `redis://` or `rediss://` URLs.

Supported URL fields:

- host
- port
- username
- password
- TLS through `rediss://`

Throws `Invalid Valkey URL` for malformed URLs.

## Dynamic Config Pub/Sub Client

```ts
ensureDynamicConfigValkeySubscriptionClient(): Promise<GlideClient>
closeDynamicConfigValkeySubscriptionClient(): Promise<void>
```

`ensureDynamicConfigValkeySubscriptionClient()` creates or returns the shared pub/sub client subscribed to `dynamic-config:*`.

`closeDynamicConfigValkeySubscriptionClient()` unsubscribes and closes the shared pub/sub client.

## Pub/Sub Handlers

```ts
addPubSubMessageHandler(handler: (msg: PubSubMsg) => void): void
removePubSubMessageHandler(handler: (msg: PubSubMsg) => void): void
```

Registers or removes handlers that receive dynamic-config pub/sub messages.

## Shutdown

```ts
closeValkeyClients(): Promise<void>
onGracefulShutdown(): Promise<void>
```

Both exports point to the same idempotent shutdown function. It closes all live dynamic configs, package-managed clients, and the dynamic-config subscription client.
