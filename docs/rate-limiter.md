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
