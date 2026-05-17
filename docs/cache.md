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

## Import

```ts
import { ValkeyCache } from "valkyries";
```

or:

```ts
import { ValkeyCache } from "valkyries/cache";
```

## Constructor

```ts
const cache = new ValkeyCache({ prefix: "users", ttlSeconds: 300 });
```

```ts
type ValkeyCacheOptions<K = string> = {
  prefix: string;
  ttlSeconds: number;
  nullTtlSeconds?: number;
  mode?: "json" | "text" | "buffer";
  staleTtlAge?: number;
  bloomFilter?: ValkeyBloomFilter;
  bloomFilterEnabled?: () => boolean;
  client?: GlideClient;
  keySerializer?: (key: K) => string;
};
```

For non-string keys, `keySerializer` is required.

- `prefix`: namespace for this cache.
- `ttlSeconds`: TTL for non-null values.
- `nullTtlSeconds`: TTL for cached nulls. Defaults to `Math.max(1, Math.floor(ttlSeconds / 60))`.
- `mode`: serialization mode. Defaults to `json`.
- `staleTtlAge`: refresh-ahead threshold from `0` to `1`. Defaults to `0.9`.
- `bloomFilter`: optional negative-lookup Bloom filter.
- `bloomFilterEnabled`: optional per-call gate for Bloom filter checks.
- `client`: optional `@valkey/valkey-glide` client. Defaults to the package cache client.
- `keySerializer`: converts keys to strings before trimming and lowercasing.

The constructor throws when `prefix` is empty, `ttlSeconds` is not positive, or `staleTtlAge` is outside `0..1`.

## `cacheGetByAny(fn)`

```ts
cache.cacheGetByAny<T>(
  fn: (key: K) => Promise<T | null | undefined>,
): (key: K) => Promise<T | null>
```

Returns a read-through single-key cache wrapper.

Behavior:

- Invalid, null, undefined, or empty serialized keys return `null`.
- Cache hits return the decoded value.
- Cached nulls return `null` without calling `fn`.
- Misses call `fn(key)`.
- `undefined` from `fn` is normalized to `null`.
- Miss results are written asynchronously when no invalidation marker is present.
- Stale hits can trigger asynchronous refresh-ahead.

## `cacheGetByAnyBatch(batchFn)`

```ts
cache.cacheGetByAnyBatch<T>(
  batchFn: (keys: K[]) => Promise<Array<T | null | undefined>>,
): (keys: K[]) => Promise<Array<T | null>>
```

Returns a read-through batch cache wrapper.

Behavior:

- Input order and length are preserved.
- Invalid keys return `null` in their original output positions.
- Duplicate serialized keys are fetched once and scattered back to every duplicate position.
- `batchFn` is called only for real misses.
- `batchFn` must return an array with exactly the same length as its input.
- `undefined` values are normalized to `null`.
- Fetched values are written asynchronously when no invalidation marker is present.
- Stale hits can trigger asynchronous batch refresh-ahead.

## `get(key)`

```ts
cache.get(key: K): Promise<string | Buffer | Record<string, unknown> | null>
```

Reads a cache entry directly without calling a fallback function. Returns `null` for misses, invalid keys, cached nulls, and Bloom-filter negative lookups.

## `getBatch(keys)`

```ts
cache.getBatch(keys: K[]): Promise<Array<string | Buffer | Record<string, unknown> | null>>
```

Reads multiple cache entries directly. Output order and length match the input.

## `set(key, value, ttl?)`

```ts
cache.set(key: K, value: unknown, ttl?: number): Promise<void>
```

Writes a value directly.

- Positive `ttl` overrides the cache TTL for this entry.
- `null` and `undefined` values use `nullTtlSeconds`.
- Invalid keys are ignored.
- In `text` mode, `value` must be a string.
- In `buffer` mode, `value` must be a `Buffer`.

## `setBatch(entries)`

```ts
cache.setBatch(
  entries: Array<{ key: K; value: unknown; ttl?: number }>,
): Promise<void>
```

Writes multiple values directly using a Valkey batch.

## `refreshById(aliases, fetchByKey)`

```ts
cache.refreshById<T>(
  aliases: K[],
  fetchByKey: (key: K) => Promise<T | null | undefined>,
): Promise<T | null>
```

Fetches fresh data once using the first valid alias, then writes the result to every valid alias. Use this when one entity can be addressed by several cache keys.

## `delete(...keys)`

```ts
cache.delete(...keys: K[]): Promise<number>
```

Deletes cache entries and writes short-lived invalidation markers so in-flight read-through writes do not repopulate stale data.

## `invalidateCacheGetByAny(...keys)`

```ts
cache.invalidateCacheGetByAny(...keys: K[]): Promise<number>
```

Alias for `delete(...keys)`.

## `invalidate()`

```ts
cache.invalidate(): Promise<void>
```

Deletes every cache key for this cache prefix.

## `ValkeyCache.invalidate(prefix, client?)`

```ts
ValkeyCache.invalidate(prefix: string, client?: GlideClient): Promise<void>
```

Deletes every cache key for `prefix`. Passing an empty prefix invalidates all cache namespaces visible to the client.

## `getKey(key)`

```ts
cache.getKey(key: K): string
```

Returns the Valkey cache key for a logical key. Throws when the logical key serializes to an invalid cache key.

## Events

The cache emits:

- `cache:call` with cache name, batch flag, hit/miss/bloom-miss counts, and duration.
- `cache:hit` with `{ cacheName, keys, count }`.
- `cache:miss` with `{ cacheName, keys, count }`.
- `cache:bloom-miss` with `{ cacheName, keys, count }`.
- `cache:set` with `{ cacheName, keys }`.
- `cache:set-skipped` with `{ cacheName, keys }`.
- `cache:delete` with `{ cacheName, keys }`.
- `cache:invalidate` with `{ cacheName }`.
