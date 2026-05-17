# Cache

`ValkeyCache` provides read-through helpers around Valkey keys named:

```txt
cache:{prefix}:{serializedKey}
```

Supported modes:

- `json` stores JSON values and is the default.
- `text` stores strings only.
- `buffer` stores `Buffer` values only.

Values larger than 2 KiB are gzip-compressed. Null results are cached with `nullTtlSeconds`, defaulting to `ttlSeconds / 60` with a minimum of 1 second.

`cacheGetByAny()` and `cacheGetByAnyBatch()` protect against stale miss writes by setting short-lived invalidation markers during delete operations.

Optional Bloom filter integration can skip authoritative-store calls for definite misses. If the Bloom filter is unavailable or not ready, cache reads fall back to the normal miss path.
