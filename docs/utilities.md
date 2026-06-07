# Utilities

These helpers are exported from the package root for applications that need the same normalization and serialization behavior as the built-in classes.

## `normalizeKey(key)`

```ts
normalizeKey(key: string): string
```

Trims and lowercases cache keys, then replaces `{`, `}`, and `:` with `_`.

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

## `ValkeyCacheTypeError`

```ts
class ValkeyCacheTypeError extends TypeError
```

Thrown when a cache value does not match the configured mode.

## `serializeValue(value, mode)`

```ts
serializeValue(
  value: unknown,
  mode: "json" | "text" | "buffer",
): Promise<string | Buffer>
```

Serializes values for cache storage and gzip-compresses payloads larger than 2 KiB.

## `decodeValue(result, mode)`

```ts
decodeValue(
  result: GlideString | null,
  mode: "json" | "text" | "buffer",
): Promise<string | Buffer | Record<string, unknown> | null>
```

Decodes and decompresses cache values. Returns `null` for Valkey misses.

## `durationInMilliseconds(start)`

```ts
durationInMilliseconds(start: bigint): number
```

Converts a `process.hrtime.bigint()` start timestamp to elapsed milliseconds.
