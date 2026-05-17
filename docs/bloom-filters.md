# Bloom Filters

`ValkeyBloomFilter` wraps `BF.RESERVE`, `BF.MADD`, `BF.EXISTS`, and `BF.MEXISTS` with ready-key and zero-downtime rebuild helpers.

Important behavior:

- `exists()` and `mexists()` return `null` when the filter key is missing.
- `existsIfReady()` and `mexistsIfReady()` also require an external ready marker.
- `add()` writes to the live key and to the building key when a rebuild is active.
- `rebuildFromStream()` builds under `bloom-filter:{name}:building` and renames it over the live key.

Large Lua-backed calls are clamped to `LUA_UNPACK_BATCH_SIZE` to avoid Valkey Lua argument limits.
