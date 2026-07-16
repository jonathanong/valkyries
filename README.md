# valkyries

Valkey utilities for Node.js services: cache helpers, Bloom filters, dynamic configuration, and sliding-window rate limiting.

## Install

```sh
pnpm add valkyries @valkey/valkey-glide
```

`valkyries` is ESM-only and requires Node.js 24 or newer.

## Valkey

By default the package reads `VALKEY_URL`, falling back to `redis://localhost:6379`.

Specialized URLs can split traffic by data type:

```sh
VALKEY_CACHE_URL=redis://localhost:6379
VALKEY_RATE_LIMITER_URL=redis://localhost:6379
VALKEY_DYNAMIC_CONFIG_URL=redis://localhost:6379
```

Connection tuning (applies to all package-managed clients):

```sh
VALKEY_INFLIGHT_REQUESTS_LIMIT=1000  # max concurrent in-flight requests per client (default: 1000)
VALKEY_REQUEST_TIMEOUT_MS=500        # per-request timeout in milliseconds (default: 500)
```

Bloom filters require Valkey with the Bloom module. For local development and CI, use Valkey Bundle:

```sh
docker run --rm -p 6379:6379 valkey/valkey-bundle:latest
```

## Cache

```ts
import { ValkeyCache } from "valkyries";

const cache = new ValkeyCache({ prefix: "users", ttlSeconds: 300 });

const getUser = cache.cacheGetByAny(async (id) => {
  return await loadUserFromDatabase(id);
});

const user = await getUser("user_123");
await cache.invalidateCacheGetByAny("user_123");
```

Cache keys are normalized with `trim().toLowerCase()`. Use `keySerializer` for composite keys.

## Bloom Filters

```ts
import { ValkeyBloomFilter } from "valkyries";

const filter = new ValkeyBloomFilter({
  name: "users",
  capacity: 1_000_000,
  errorRate: 0.01,
});

await filter.ensureExists();
await filter.add(["user_123"]);

const maybeExists = await filter.existsIfReady("users:ready", "user_123");
```

`null` means the filter is missing or not ready and callers should fall back to the authoritative store.

## Dynamic Config

```ts
import { DynamicConfig } from "valkyries";

const flags = new DynamicConfig({
  key: "feature-flags",
  fieldTypes: { enabled: "boolean", sampleRate: "number" },
  defaultFields: { enabled: false, sampleRate: 0 },
});

await flags.waitForInitialization();
await flags.setField("enabled", true);
```

Dynamic config stores fields in a Valkey hash and publishes changes over pub/sub.

## Rate Limiter

```ts
import { RateLimiter } from "valkyries";

const limiter = new RateLimiter({ prefix: "login", ttlSeconds: 60 });
const { limited, counts } = await limiter.addAndCheck(["ip:127.0.0.1"], 10);
```

`addAndCheck()` increments first and blocks when any post-add count is greater than or equal to the threshold.

## Client Injection

Every class accepts an optional `GlideClient` for tests or custom connection management:

```ts
import { GlideClient } from "@valkey/valkey-glide";
import { ValkeyCache, glideConfigFromUrl } from "valkyries";

const client = await GlideClient.createClient(glideConfigFromUrl("redis://localhost:6379"));
const cache = new ValkeyCache({ prefix: "custom", ttlSeconds: 60, client });
```

Call `closeValkeyClients()` to close package-managed clients.

## Documentation

- [Configuration](docs/configuration.md)
- [API reference](docs/api.md)
- [Clients](docs/clients.md)
- [Cache](docs/cache.md)
- [Bloom filters](docs/bloom-filters.md)
- [Dynamic config](docs/dynamic-config.md)
- [Rate limiter](docs/rate-limiter.md)
- [Idempotency keys](docs/idempotency-key.md)
- [Conditional operations](docs/conditional-operations.md)
- [Events and metrics](docs/events-and-metrics.md)
- [Lua scripts](docs/lua-scripts.md)
- [Utilities](docs/utilities.md)
- [Testing and CI](docs/testing-and-ci.md)
- [Migration guide](docs/migration.md)
