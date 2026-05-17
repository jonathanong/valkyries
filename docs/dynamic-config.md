# Dynamic Config

`DynamicConfig` stores runtime fields in a Valkey hash under:

```txt
dynamic-config:{key}
```

Fields are declared with `fieldTypes` and initialized from `defaultFields`. Missing defaults are written during initialization.

Use `setField()` or `setFields()` to update values. Updates are written with a Lua script that performs `HSET` and `PUBLISH` in one roundtrip.

Each instance subscribes to `dynamic-config:*` and applies matching field updates from pub/sub. Call `close()` in tests and shutdown paths to remove handlers and clear refresh timers.
