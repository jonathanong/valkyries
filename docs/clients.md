# Clients

The package exports default clients for simple applications:

- `cacheValkeyClient`
- `rateLimiterValkeyClient`
- `dynamicConfigValkeyClient`

Connections are deduplicated by URL, read preference, and lazy-connect setting through `upsertValkeyClientByUrl()`.

For libraries, tests, and multi-tenant services, pass a `GlideClient` directly to `ValkeyCache`, `ValkeyBloomFilter`, `DynamicConfig`, or `RateLimiter`.

Use `closeValkeyClients()` or `onGracefulShutdown()` to close package-managed clients and the dynamic-config pub/sub connection.
