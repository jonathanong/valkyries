# API Reference

This is the entry point for the public `valkyries` API. Detailed API documentation lives with each relevant class or topic.

## Classes

- [`ValkeyCache`](cache.md) - read-through cache helpers, direct get/set APIs, invalidation, stale refresh, and Bloom-filter integration.
- [`ValkeyBloomFilter`](bloom-filters.md) - Bloom filter lookup, writes, readiness markers, streaming rebuilds, and key helpers.
- [`DynamicConfig`](dynamic-config.md) - distributed runtime fields backed by Valkey hashes and pub/sub updates.
- [`RateLimiter`](rate-limiter.md) - sliding-window rate limiting backed by sorted sets and Lua scripts.
- [Idempotency keys](idempotency-key.md) - consume-once values and token-fenced idempotency-key lifecycle helpers.

## Supporting APIs

- [Clients](clients.md) - default clients, client injection, URL parsing, pub/sub client management, and shutdown.
- [Events and metrics](events-and-metrics.md) - `valkeyEvents`, cache metrics, event payloads, and error handling hooks.
- [Lua scripts](lua-scripts.md) - packaged Lua scripts and script-loading helpers.
- [Configuration](configuration.md) - environment variables and connection behavior.
- [Utilities](utilities.md) - key and Valkey result normalization helpers.

## Package Entry Points

```ts
import {
  ValkeyCache,
  ValkeyBloomFilter,
  DynamicConfig,
  RateLimiter,
  getAndDelete,
  reserveIdempotencyKey,
  closeValkeyClients,
  scanAndUnlinkKeys,
  expireKeysWithNoExpiry,
} from "valkyries";
```

Supported subpath exports:

- `valkyries`
- `valkyries/cache`
- `valkyries/bloom-filter`
- `valkyries/dynamic-config`
- `valkyries/idempotency-key`
- `valkyries/rate-limiter`

`valkyries` is ESM-only and requires Node.js 24 or newer.
