# Configuration

`VALKEY_URL` is the default URL for all package-managed clients.

Specialized URLs override it:

- `VALKEY_CACHE_URL`
- `VALKEY_RATE_LIMITER_URL`
- `VALKEY_DYNAMIC_CONFIG_URL`

Redis-style URLs are supported:

- `redis://localhost:6379`
- `rediss://user:password@example.com:6380`

The cache client uses `readFrom: "preferReplica"`. Rate limiter reads use `primary` to avoid replica lag. Dynamic config commands use `preferReplica`; pub/sub uses a dedicated eager connection.
