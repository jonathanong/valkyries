# Clients

The package exports default clients for simple applications:

- `cacheValkeyClient`
- `rateLimiterValkeyClient`
- `dynamicConfigValkeyClient`

Connections are deduplicated by URL, read preference, and lazy-connect setting through `upsertValkeyClientByUrl()`.

For libraries, tests, and multi-tenant services, pass a `GlideClient` directly to `ValkeyCache`, `ValkeyBloomFilter`, `DynamicConfig`, or `RateLimiter`.

Use `closeValkeyClients()` (or the argument-free `onGracefulShutdown()`) to close package-managed clients and the dynamic-config pub/sub connection.

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
closeValkeyClients(options?: { throwOnError?: boolean }): Promise<void>
onGracefulShutdown(): Promise<void>
```

`closeValkeyClients()` closes all live dynamic configs first, then package-managed clients and the dynamic-config subscription client. Closing `dynamicConfigs` yourself before calling it is unnecessary. `onGracefulShutdown()` runs the same sequence but takes no arguments, so it is safe to pass directly as a signal or lifecycle callback.

By default, close failures are reported to `handleValkeyError` and the promise always resolves. With `throwOnError: true`, failures are still reported to `handleValkeyError`; after every close has settled, the promise rejects with `new AggregateError(errors, "Valkey shutdown failed")`.

```ts
try {
  await closeValkeyClients({ throwOnError: true });
} catch (error) {
  if (error instanceof AggregateError) process.exitCode = 1;
}
```

Shutdown runs once per process. Repeated calls are no-ops that resolve immediately, including a later call that passes `throwOnError: true` after an earlier call without it: it neither re-closes anything nor reports the earlier failures.
