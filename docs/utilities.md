# Utilities

These normalization helpers are exported from the package root.

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
