# Idempotency Keys

Generic Valkey primitives for consume-once values and token-fenced idempotency keys.

## `getAndDelete(key, options?)`

```ts
getAndDelete(key: string, options?: { client?: GlideClient }): Promise<string | null>
```

Atomically reads and deletes a key using native `GETDEL`.

- Returns the stored string value.
- Returns `null` when the key does not exist.
- Throws Valkey/client errors.
- Requires Valkey support for `GETDEL`.

## `reserveIdempotencyKey(key, ttlSeconds, options?)`

```ts
reserveIdempotencyKey(
  key: string,
  ttlSeconds: number,
  options?: {
    client?: GlideClient;
    processingPrefix?: string;
    completedValue?: string;
    token?: string;
    repairMissingExpiry?: {
      completedTtlSeconds?: number;
    };
  },
): Promise<
  | { state: "reserved"; token: string }
  | { state: "processing" | "completed" }
>
```

Atomically reserves a key when it is absent by storing `processing:<token>` with `EX ttlSeconds`.

- Generates a random token by default.
- Returns `processing` when another reservation is active.
- Returns `completed` when the dedup key has already completed.
- When `repairMissingExpiry` is present, persistent existing processing values receive
  `ttlSeconds` and persistent completed values receive `completedTtlSeconds`.
- `completedTtlSeconds` defaults to `ttlSeconds`; `EXPIRE ... NX` preserves existing expirations.
- Missing-expiry repair is disabled by default.
- The caller owns key naming and Redis Cluster hash tags.

## `completeIdempotencyKey(key, token, ttlSeconds, options?)`

```ts
completeIdempotencyKey(
  key: string,
  token: string,
  ttlSeconds: number,
  options?: IdempotencyKeyOptions,
): Promise<"completed" | "missing" | "changed">
```

Atomically changes `processing:<token>` to `completed` with `EX ttlSeconds`.

- `completed`: completion is recorded, including when the key was already completed.
- `missing`: the key was absent.
- `changed`: the key existed but did not match the caller's token.

Completed values do not retain their reservation token, so an already-completed result cannot
prove which owner originally completed it. Treating that result as success makes completion safe
to retry after an ambiguous client or network failure.

## `releaseIdempotencyKey(key, token, options?)`

```ts
releaseIdempotencyKey(
  key: string,
  token: string,
  options?: IdempotencyKeyOptions,
): Promise<boolean>
```

Atomically deletes the key only when it still contains `processing:<token>`.

- Returns `true` when released.
- Returns `false` when the key is missing or owned by another token.

## Example

```ts
const key = `webhook:{${event.id}}`;
const reservation = await reserveIdempotencyKey(key, 60);

if (reservation.state === "completed") return;
if (reservation.state === "processing") throw new Error("event is already processing");

try {
  await processEvent(event);
  await completeIdempotencyKey(key, reservation.token, 24 * 60 * 60);
} catch (error) {
  await releaseIdempotencyKey(key, reservation.token);
  throw error;
}
```

## Validation

- `key`, `token`, `processingPrefix`, and `completedValue` must be non-empty.
- `ttlSeconds` and `completedTtlSeconds` must be positive safe integers.
- `processingPrefix` must not equal `completedValue`.
- `processingPrefix` and `completedValue` must not equal script result sentinels:
  `reserved`, `missing`, or `changed`.
- `completedValue` must not be inside the processing namespace
  (`${processingPrefix}:...`).
- Valkey/client errors throw instead of failing open.
