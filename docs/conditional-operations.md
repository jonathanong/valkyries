# Conditional Operations

Generic single-key operations for application-owned Valkey values.

## `unlinkIfValueMatches(key, expectedValue, options?)`

```ts
unlinkIfValueMatches(
  key: string,
  expectedValue: string,
  options?: { client?: GlideClient },
): Promise<boolean>
```

Atomically reads and unlinks one key using a Lua script.

- Returns `true` only when the stored string matched `expectedValue` and was unlinked.
- Returns `false` when the key is absent or its value changed.
- Accepts an empty expected value, but the key must be non-empty.
- Throws Valkey/client errors and unexpected script responses.
- Defaults to the package cache client.

The helper is single-key and Redis Cluster safe. Callers own key naming and any hash tags needed
to colocate this key with other application operations.
