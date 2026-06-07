# Rate Limiter

`RateLimiter` uses sorted sets with server time to implement sliding windows.

Key format:

```txt
rate-limiter:<prefix>:{<id>}
```

Use `addAndCheck(ids, threshold)` for request paths. It atomically adds an event, removes expired events, counts the current window, and returns:

```ts
{ counts: number[]; limited: boolean }
```

A threshold of `N` blocks the Nth request because the count is checked after incrementing.

Use `RateLimiter.addAndCheckWindows(windows)` when one logical request must be checked against multiple TTL/threshold windows in one Valkey round trip. All windows in that call must share one Redis Cluster hash tag.

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

## `RateLimiter.addAndCheckWindows(windows, options?)`

```ts
RateLimiter.addAndCheckWindows(
  [
    { prefix: "web-risk-minute", id: "global", hashTag: "2026-06", ttlSeconds: 60, threshold: 5001 },
    { prefix: "web-risk-month", id: "global", hashTag: "2026-06", ttlSeconds: 31 * 24 * 60 * 60, threshold: 90001 },
  ],
  { mode: "stop-on-limited" },
): Promise<{ counts: number[]; limited: boolean }>
```

Records and checks heterogeneous windows in one Lua script call.

- `counts` aligns with `windows`.
- `limited` is `true` when any post-add count is greater than or equal to its window threshold.
- `mode: "record-all"` records every window and is the default.
- `mode: "stop-on-limited"` stops recording later windows after an earlier window is limited.
- `skipWriteWhenLimited: true` on a window trims expired entries and checks the current count before writing. If the window is already at or above its threshold, that window returns its current count and does not add another sorted-set member.
- The request that reaches the threshold is still recorded and returns the post-add count.
- All windows must share the same effective hash tag: `hashTag ?? id`.
- Window prefixes must not contain Redis hash tag braces, and generated Valkey keys must be unique.
- Unexpected Valkey response types fail open with zero counts.

Example:

```ts
const { counts, limited } = await limiter.addAndCheck(["ip:127.0.0.1"], 10);
```

Scarce provider quota windows can avoid member churn after a long-window quota is capped:

```ts
const month = "2026-06";

const result = await RateLimiter.addAndCheckWindows(
  [
    {
      prefix: "web-risk-minute",
      id: "global",
      hashTag: month,
      ttlSeconds: 60,
      threshold: 5001,
    },
    {
      prefix: "web-risk-month",
      id: "",
      hashTag: month,
      ttlSeconds: 31 * 24 * 60 * 60,
      threshold: 90001,
      skipWriteWhenLimited: true,
    },
  ],
  { mode: "stop-on-limited" },
);
```

## `RateLimiter.getWindowKey(window)`

```ts
RateLimiter.getWindowKey(window: RateLimiterWindow): string
```

Returns the Valkey sorted-set key for a multi-window definition. Use this to assert Redis Cluster compatibility and stable quota bucket shapes without duplicating key logic.

```ts
RateLimiter.getWindowKey({
  prefix: "web-risk-month",
  id: "",
  hashTag: "2026-06",
  ttlSeconds: 31 * 24 * 60 * 60,
  threshold: 90001,
});
// "rate-limiter:web-risk-month:{2026-06}"
```

Key shapes:

```txt
rate-limiter:<prefix>:{<id>}
rate-limiter:<prefix>:{<hashTag>}:<id>
rate-limiter:<prefix>:{<hashTag>}
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
rate-limiter:<prefix>:{<id>}
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
