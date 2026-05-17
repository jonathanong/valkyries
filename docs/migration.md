# Migration Guide

Use this guide when moving existing Valkey-backed cache, Bloom filter, dynamic config, or rate limiter code to `valkyries`.

## Install

```sh
pnpm add valkyries @valkey/valkey-glide
```

`valkyries` is ESM-only and requires Node.js 24 or newer.

## Update Imports

Import public classes and helpers from `valkyries` instead of local application modules:

```ts
import { ValkeyCache, ValkeyBloomFilter, DynamicConfig, RateLimiter } from "valkyries";
```

Subpath imports are also available:

```ts
import { ValkeyCache } from "valkyries/cache";
import { ValkeyBloomFilter } from "valkyries/bloom-filter";
import { DynamicConfig } from "valkyries/dynamic-config";
import { RateLimiter } from "valkyries/rate-limiter";
```

## Configure Connections

The default connection URL is `VALKEY_URL`.

Use specialized URLs when you want separate pools or clusters:

```sh
VALKEY_CACHE_URL=redis://localhost:6379
VALKEY_RATE_LIMITER_URL=redis://localhost:6379
VALKEY_DYNAMIC_CONFIG_URL=redis://localhost:6379
```

Every primary class also accepts a `client` option for explicit `GlideClient` ownership.

## Review Removed Responsibilities

`valkyries` contains only Valkey data-store primitives:

- Cache helpers
- Bloom filters
- Dynamic configuration
- Rate limiting
- Shared Valkey clients, events, scripts, and shutdown helpers

Queueing, job orchestration, service-specific metrics backends, and application-specific error reporting should stay in the consuming application.

## Replace Application-Specific Hooks

The package exposes generic hooks for behavior that applications usually customize:

- `setValkeyErrorHandler(handler)` for error reporting
- `valkeyEvents` / `emitValkeyEvent()` for event and metric collection
- Per-class `client` options for custom connection lifecycle management

## Validate

Run the package checks locally with a Valkey Bundle instance:

```sh
docker run --rm -p 6379:6379 valkey/valkey-bundle:latest
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run test:coverage
```
