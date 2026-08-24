# Utilities

These normalization helpers are exported from the package root.

## `scanAndUnlinkKeys(client, pattern, options)`

```ts
scanAndUnlinkKeys(
  client: GlideClient,
  pattern: string,
  options?: {
    signal?: AbortSignal;
    matches?: (key: GlideString) => boolean;
  },
): Promise<{ scannedKeys: number; matchedKeys: number; unlinkedKeys: number }>
```

Scans with `COUNT 500`, unlinks every scanned key accepted by `matches`, and returns the number of
keys scanned, predicate-matched, and confirmed removed by `UNLINK`. Keys are provided to `matches`
and `UNLINK` as their original string or `Buffer` `GlideString` values.

`SCAN` is non-snapshot: concurrent writes can make counts include duplicates, omit keys, or differ
from the keys that exist when the call returns. The optional `signal` is checked before and after
every SCAN and UNLINK boundary; its exact abort reason is rethrown without reporting it to the
configured Valkey error handler.

## `normalizeKey(key)`

```ts
normalizeKey(key: string): string
```

Trims and lowercases cache keys.

## `normalizeTtlResult(value)`

```ts
normalizeTtlResult(value: unknown): number | null
```

Normalizes Valkey millisecond TTL values to seconds. Preserves `-2` and `-1` sentinel values.

## `normalizeCountResult(value)`

```ts
normalizeCountResult(value: unknown): number
```

Normalizes numeric or bigint Valkey counts. Returns `0` for unexpected values.
