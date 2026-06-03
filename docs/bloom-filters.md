# Bloom Filters

`ValkeyBloomFilter` wraps `BF.RESERVE`, `BF.MADD`, `BF.EXISTS`, and `BF.MEXISTS` with ready-key and zero-downtime rebuild helpers.

Important behavior:

- `exists()` and `mexists()` return `null` when the filter key is missing.
- `existsIfReady()` and `mexistsIfReady()` also require an external ready marker.
- `add()` writes to the live key and to the building key when a rebuild is active.
- `rebuildFromStream()` builds under `bloom-filter:{name}:building` and renames it over the live key.

Large Lua-backed calls are clamped to `LUA_UNPACK_BATCH_SIZE` to avoid Valkey Lua argument limits.

## Import

```ts
import { ValkeyBloomFilter } from "valkyries";
```

or:

```ts
import { ValkeyBloomFilter } from "valkyries/bloom-filter";
```

## Constructor

```ts
const filter = new ValkeyBloomFilter({
  name: "users",
  capacity: 1_000_000,
  errorRate: 0.01,
});
```

```ts
type ValkeyBloomFilterOptions = {
  name: string;
  capacity: number;
  errorRate: number;
  batchSize?: number;
  concurrencyLimit?: number;
  expansionRate?: number;
  client?: GlideClient;
};
```

- `name`: filter namespace. The live key is `bloom-filter:${name}`.
- `capacity`: expected item count.
- `errorRate`: target false-positive rate between `0` and `1`.
- `batchSize`: write/read chunk size. Defaults to `10_000`; Lua paths clamp large chunks internally.
- `concurrencyLimit`: maximum number of write chunks in flight at once. Defaults to `16`.
- `expansionRate`: Bloom filter expansion rate. Defaults to `2`.
- `client`: optional `@valkey/valkey-glide` client. Defaults to the package cache client.

The constructor throws when `name` is empty, `capacity` is not positive, `errorRate` is not between `0` and `1`, `expansionRate` is not positive, `batchSize` is not positive, or `concurrencyLimit` is not positive.

## `ensureExists(capacity?)`

```ts
filter.ensureExists(capacity?: number): Promise<void>
```

Creates the live Bloom filter when it does not already exist. `capacity` overrides the configured capacity for this call.

## `exists(item)`

```ts
filter.exists(item: string): Promise<boolean | null>
```

Checks one item.

- `true`: the item may exist.
- `false`: the item definitely does not exist.
- `null`: the filter is missing; callers should fall back to the authoritative store.

## `mexists(items)`

```ts
filter.mexists(items: string[]): Promise<Array<boolean | null>>
```

Checks multiple items. Output order and length match input.

## `existsIfReady(readyKey, item)`

```ts
filter.existsIfReady(readyKey: string, item: string): Promise<boolean | null>
```

Checks one item only when both the ready marker and live filter exist. Returns `null` when either key is absent.

## `mexistsIfReady(readyKey, items)`

```ts
filter.mexistsIfReady(
  readyKey: string,
  items: string[],
): Promise<Array<boolean | null>>
```

Batch version of `existsIfReady`.

## `add(items)`

```ts
filter.add(items: string[]): Promise<void>
```

Adds items in chunks. Errors are routed to the configured Valkey error handler.

If neither the live key nor the building key exists, this is a no-op to avoid auto-creating an undersized filter.

## `addOrThrow(items)`

```ts
filter.addOrThrow(items: string[]): Promise<void>
```

Same write path as `add()`, but propagates write errors.

## `addStream(batches)`

```ts
filter.addStream(batches: AsyncIterable<string[]>): Promise<void>
```

Adds streamed batches and propagates errors.

## `rebuild(items)`

```ts
filter.rebuild(items: string[]): Promise<void>
```

Rebuilds from a complete list using a building key and atomic rename.

## `rebuildFromStream(batches, capacityOverride?)`

```ts
filter.rebuildFromStream(
  batches: AsyncIterable<string[]>,
  capacityOverride?: number,
): Promise<void>
```

Rebuilds from streamed batches. `capacityOverride` is useful when the live row count is known at rebuild time.

## `delete()`

```ts
filter.delete(): Promise<void>
```

Deletes the live and building keys.

## `deleteWithAdditionalKeys(additionalKeys)`

```ts
filter.deleteWithAdditionalKeys(additionalKeys: string[]): Promise<void>
```

Deletes the live key, building key, and additional caller-owned keys such as readiness markers.

## `keyExists()`

```ts
filter.keyExists(): Promise<boolean>
```

Returns whether the live filter key exists.

## `isReady(readyKey)`

```ts
filter.isReady(readyKey: string): Promise<boolean>
```

Returns `true` only when both the live filter key and `readyKey` exist.

## `getKey()`

```ts
filter.getKey(): string
```

Returns the live filter key.

## `getBuildingKey()`

```ts
filter.getBuildingKey(): string
```

Returns the staging key used by rebuilds.

## `getConfig()`

```ts
filter.getConfig(): {
  name: string;
  capacity: number;
  errorRate: number;
  batchSize: number;
  liveKey: string;
  buildingKey: string;
}
```

Returns runtime configuration values.

## Helper Exports

```ts
import {
  LUA_UNPACK_BATCH_SIZE,
  isBloomMissingKeyError,
  normalizeBloomCheckResult,
} from "valkyries";
```

- `LUA_UNPACK_BATCH_SIZE`: maximum Lua unpack batch size used internally.
- `isBloomMissingKeyError(error)`: detects missing Bloom filter errors.
- `normalizeBloomCheckResult(result)`: normalizes Valkey Bloom return values to booleans.

## Events

The Bloom filter emits:

- `bloom-filter:exists` with `{ name, item, result }`.
- `bloom-filter:mexists` with `{ name, items, results }`.
- `bloom-filter:add` with `{ name, items }`.
