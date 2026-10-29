# Lua Scripts

Lua scripts live in `scripts/` and are copied to `dist/scripts/` during build.

Use `loadScript()` and `registerScript()` for package scripts. Registered scripts are released on process exit.

Scripts are used when operations must be atomic or when combining multiple Valkey commands into one roundtrip.

## `loadScript(relativePath, baseUrl)`

```ts
loadScript(relativePath: string, baseUrl: string | URL): string
```

Loads a Lua script from `scripts/` relative to `baseUrl`.

Under Bun, the package's own scripts (loaded internally, not through `loadScript`) are imported as text modules (`lua-sources.bun.mts`, selected by the `bun` condition of the package's `#lua-sources` import), so `bun build --compile` embeds them and the executable reads no script files. `loadScript` itself always reads from disk, so a caller's own script is never replaced by a packaged one of the same name. When adding a script to `scripts/`, add its import to `lua-sources.bun.mts`; a test fails until the two match.

## `registerScript(code)`

```ts
registerScript(code: string): Script
```

Creates a Glide `Script`, registers it for process-exit release, and returns it.

## Packaged Scripts

Cache scripts:

- `cache-delete-with-invalidation.lua`
- `cache-set-if-not-invalidated.lua`
- `get-value-with-ttl.lua`
- `get-values-with-ttl.lua`

Bloom filter scripts:

- `bloom-filter-add.lua`
- `bloom-filter-ensure-exists.lua`
- `bloom-filter-exists.lua`
- `bloom-filter-exists-if-ready.lua`
- `bloom-filter-mexists.lua`
- `bloom-filter-mexists-if-ready.lua`
- `bloom-filter-reserve.lua`

Dynamic config scripts:

- `dynamic-config-set-fields.lua`

Idempotency key scripts:

- `idempotency-key-complete-if-current.lua`
- `idempotency-key-release-if-current.lua` (compatibility filename; new code uses conditional unlink)
- `idempotency-key-reserve.lua`

Conditional operation scripts:

- `pexpire-if-value-matches.lua`
- `unlink-if-value-matches.lua`

Rate limiter scripts:

- `rate-limiter-add.lua`
- `rate-limiter-add-and-check.lua`
- `rate-limiter-add-and-check-windows.lua`
- `rate-limiter-consume.lua`
- `rate-limiter-get.lua`
