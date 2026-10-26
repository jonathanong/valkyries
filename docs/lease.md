# Renewable Leases

A generic, token-owned Valkey lease: one active owner of a named resource across processes, a
finite millisecond TTL, automatic renewal while owned, and a local ownership-loss notification.

This is a normal renewable lease. It is **not a fencing token** and not a distributed
transaction. A paused or disconnected former owner can overlap a successor after its key expires
or is lost. Callers stop starting new work when ownership is lost, but must let already-dispatched
external work finish. The helper never cancels, races, discards or detaches caller work.

## `acquireRenewableLease(key, options)`

```ts
acquireRenewableLease(
  key: string,
  options: {
    ttlMs: number;
    renewalIntervalMs?: number;
    client: GlideClient;
  },
): Promise<RenewableLease | null>

interface RenewableLease {
  readonly isHeld: boolean;
  readonly lost: Promise<RenewableLeaseLoss>;
  release(): Promise<boolean>;
}

type RenewableLeaseLoss =
  | { reason: "not-owner" }
  | { reason: "renewal-error"; error: unknown }
  | { reason: "expired" };
```

Import from `valkyries/lease` or the package root.

### Options

- `ttlMs`: safe integer, `2 <= ttlMs <= 2^31 - 1`.
- `renewalIntervalMs`: `1 <= n < ttlMs`. Defaults to `max(1, floor(ttlMs / 3))`.
- `client`: **required, no default.** Invalid values are rejected before any command is sent.

### Client requirements: primary with `noeviction`

The client must target a primary whose server uses `maxmemory-policy noeviction`. Eviction can
delete a held lease key: another acquirer then succeeds and overlaps with no loss signal until the
owner's next renewal. `volatile-*` policies can evict leases too, because every lease carries a
TTL. The package cache client (`VALKEY_CACHE_URL`, `preferReplica`) typically runs an eviction
policy such as `allkeys-lru`, and the rate-limiter URL falls back to the cache URL, so neither is
used as a default. The lease never closes the client you pass in.

### Acquisition

- Atomically `SET key <fresh-uuid> NX PX ttlMs`. The token is private and fresh per attempt.
- Resolves `null` only for a confirmed NX collision. Transport errors reject; they are never
  reported as contention. There is no retry, waiting or backoff.
- Renewal starts only after a confirmed acquisition. If the acknowledgement arrives after the
  conservative validity window already elapsed, the call best-effort releases its own token and
  rejects instead of returning a lease.

### Renewal and loss

- Renewal is serialized (never two commands at once) and uses one atomic owner check plus
  `PEXPIRE` (`pexpireIfValueMatches`). It never recreates a missing key or adopts another token.
- A compare miss, including a key that was evicted, deleted or expired, resolves `lost` with
  `not-owner`. A renewal exception resolves it with `renewal-error` and the original error.
- Validity is tracked with `performance.now()`, measured from command dispatch. `isHeld` checks the
  deadline on every read; if it has passed, loss is settled synchronously (`expired`) before it
  returns `false`. A hung renewal cannot keep `isHeld` true past the last confirmed window.
- Loss is local state set before `lost` resolves, resolves at most once, never rejects, and stops
  all renewal. A late renewal response never revives a lost or released lease.
- Timers are `unref()`'d. Loss is detected locally, not pushed by the server.

### `release()`

Marks the lease not-held and stops scheduling before its first await, waits for any in-flight
renewal, then conditionally unlinks the key only if it still holds this lease's token
(`unlinkIfValueMatches`).

- Resolves `true` if the owned key was deleted, `false` if it was absent or owned by a successor.
- Cleanup errors reject; renewal stays stopped. Concurrent and repeated calls share one attempt and
  one outcome (including rejection). There is no cleanup retry.
- Valid after loss. Explicit release does not resolve `lost`.

## Usage

```ts
const lease = await acquireRenewableLease(resourceKey, { ttlMs: 30_000, client });
if (!lease) return deferSameWork();
try {
  while (lease.isHeld && moreWorkRemains()) {
    const input = await prepareNextOperation();
    if (!lease.isHeld) break;
    // Do not race this operation against lease.lost or pass loss as an abort.
    await submitOperationAndRecordResult(input);
  }
} finally {
  await lease.release();
}
```
