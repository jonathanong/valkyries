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

## Saturation retries

`VALKEY_INFLIGHT_RETRY_ATTEMPTS` (default `3`) and `VALKEY_INFLIGHT_RETRY_DELAY_MS` (default `1000`) set how internal command boundaries retry commands the client rejects locally with `Reached maximum inflight requests`. The exported `retrySaturationError(fn, options?)` uses the same values when `options.attempts` / `options.delayMs` are omitted; explicit options take precedence. Delays are jittered in `[delayMs, delayMs * 5]`.
