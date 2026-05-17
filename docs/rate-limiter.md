# Rate Limiter

`RateLimiter` uses sorted sets with server time to implement sliding windows.

Key format:

```txt
rate-limiter:{prefix}:{id}
```

Use `addAndCheck(ids, threshold)` for request paths. It atomically adds an event, removes expired events, counts the current window, and returns:

```ts
{ counts: number[]; limited: boolean }
```

A threshold of `N` blocks the Nth request because the count is checked after incrementing.

## Import

```ts
import { RateLimiter } from "valkyries";
```

or:

```ts
import { RateLimiter } from "valkyries/rate-limiter";
```

## Constructor

```ts
const limiter = new RateLimiter({
  prefix: "login",
  ttlSeconds: 60,
});
```

```ts
type RateLimiterOptions = {
  prefix: string;
  ttlSeconds: number;
  client?: GlideClient;
};
```

- `prefix`: namespace for this limiter.
- `ttlSeconds`: sliding-window size in seconds.
- `client`: optional `@valkey/valkey-glide` client. Defaults to the package rate-limiter client.

The limiter reads from the primary Valkey client to avoid replica lag in request-path checks.

## `add(ids)`

```ts
limiter.add(ids: string[]): Promise<void>
```

Records events for all truthy IDs. Falsy IDs are ignored.

This method writes without checking a threshold. Use it when you want to count activity separately from request admission.

## `addAndCheck(ids, threshold, ttlSeconds?)`

```ts
limiter.addAndCheck(
  ids: string[],
  threshold: number,
  ttlSeconds?: number,
): Promise<{ counts: number[]; limited: boolean }>
```

Atomically records events and returns the current counts.

- `counts` aligns with the filtered truthy IDs, not the original input.
- `limited` is `true` when any post-add count is greater than or equal to `threshold`.
- Empty or all-falsy input returns `{ counts: [], limited: false }`.
- `ttlSeconds` overrides the instance TTL for this check.
- Unexpected Valkey response types fail open with zero counts.

Example:

```ts
const { counts, limited } = await limiter.addAndCheck(["ip:127.0.0.1"], 10);
```

## `isRateLimited(ids, threshold, ttlSeconds?)`

```ts
limiter.isRateLimited(
  ids: string[],
  threshold: number,
  ttlSeconds?: number,
): Promise<boolean>
```

Reads current counts without adding a new event. Returns `true` when any ID count is greater than or equal to `threshold` within the TTL window.

## `get(ids, ttlSeconds?)`

```ts
limiter.get(ids: string[], ttlSeconds?: number): Promise<number[]>
```

Returns current counts for truthy IDs. Empty or all-falsy input returns `[]`.

The returned array aligns with the filtered truthy IDs.

## `delete(...ids)`

```ts
limiter.delete(...ids: string[]): Promise<number>
```

Deletes limiter keys for truthy IDs and returns the Valkey unlink count.

## `getKey(key)`

```ts
limiter.getKey(key: string): string
```

Returns the Valkey sorted-set key for an ID:

```txt
rate-limiter:{prefix}:{id}
```

## `invalidate()`

```ts
limiter.invalidate(): Promise<void>
```

Deletes every limiter key for this instance prefix.

## `RateLimiter.invalidate(prefix, client?)`

```ts
RateLimiter.invalidate(prefix: string, client?: GlideClient): Promise<void>
```

Deletes every limiter key for `prefix`. Passing an empty prefix invalidates all limiter namespaces visible to the client.

## Events

The rate limiter emits:

- `rate-limiter:add` with `{ prefix, ids }`
- `rate-limiter:get` with `{ prefix, ids, counts }`
- `rate-limiter:delete` with `{ prefix, ids }`
- `rate-limiter:invalidate` with `{ prefix }`
