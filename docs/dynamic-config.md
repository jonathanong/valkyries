# Dynamic Config

`DynamicConfig` stores runtime fields in a Valkey hash under:

```txt
dynamic-config:{key}
```

Fields are declared with `fieldTypes` and initialized from `defaultFields`. Missing defaults are written during initialization.

Use `setField()` or `setFields()` to update values. Updates are written with a Lua script that performs `HSET` and `PUBLISH` in one roundtrip.

Each instance subscribes to `dynamic-config:*` and applies matching field updates from pub/sub. Call `close()` in tests and shutdown paths to remove handlers and clear refresh timers.

## Import

```ts
import { DynamicConfig } from "valkyries";
```

or:

```ts
import { DynamicConfig } from "valkyries/dynamic-config";
```

## Constructor

```ts
const flags = new DynamicConfig({
  key: "feature-flags",
  fieldTypes: { enabled: "boolean", sampleRate: "number" },
  defaultFields: { enabled: false, sampleRate: 0 },
});
```

```ts
type DynamicConfigOptions = {
  staleTtlSeconds?: number | null;
  key: string;
  fieldTypes: Record<string, "string" | "number" | "boolean">;
  defaultFields: Record<string, string | number | boolean>;
  client?: GlideClient;
  inflightRetryAttempts?: number;
  inflightRetryDelayMs?: number;
};
```

- `staleTtlSeconds`: refresh interval for local fields. Defaults to `60`.
- `key`: logical config name. The hash key is `dynamic-config:${key}`.
- `fieldTypes`: allowed fields and primitive types.
- `defaultFields`: default values written when fields are missing.
- `client`: optional `@valkey/valkey-glide` client. Defaults to the package dynamic-config client.
- `inflightRetryAttempts`: attempts for a locally rejected, inflight-saturated Valkey command. Defaults to `VALKEY_INFLIGHT_RETRY_ATTEMPTS` or `3`.
- `inflightRetryDelayMs`: minimum backoff between saturation retries. Defaults to `VALKEY_INFLIGHT_RETRY_DELAY_MS` or `1000`; retry delays are jittered up to five times this value.

Only Glide's local `Reached maximum inflight requests` rejection is retried. Other Valkey errors are returned immediately; a failed refresh remains eligible for the next refresh interval, and failed writes leave local fields unchanged.

The constructor starts initialization immediately. Call `waitForInitialization()` before reading fields during startup.

Outside `NODE_ENV=test`, constructing multiple `DynamicConfig` instances with the same key throws.

## Public Properties

- `staleTtl`: refresh interval in seconds.
- `key`: Valkey hash key.
- `fields`: local field map.
- `fieldTypes`: field schema.
- `defaultFields`: default values.
- `initialization`: initialization promise.

## `waitForInitialization()`

```ts
config.waitForInitialization(): Promise<void>
```

Waits for field validation, default writes, initial field loading, pub/sub subscription, and timer creation.

## `getFields()`

```ts
config.getFields(): Record<string, string | number | boolean>
```

Returns a plain object snapshot of local fields.

## `setField(name, value)`

```ts
config.setField(name: string, value: string | number | boolean): Promise<void>
```

Writes one field and publishes the update atomically. Throws for unknown fields or invalid values for the field type.

## `setFields(fields)`

```ts
config.setFields(fields: Record<string, string | number | boolean>): Promise<void>
```

Writes multiple fields and publishes updates atomically. Local state is updated only after the Valkey write succeeds.

## `refresh()`

```ts
config.refresh(): Promise<void>
```

Refreshes local fields from Valkey when the stale TTL has elapsed. Concurrent refreshes are coalesced by an optimistic timestamp update.

## `subscribe()`

```ts
config.subscribe(): Promise<void>
```

Ensures the shared dynamic-config subscription client exists and registers this config's message handler.

## `unsubscribe()`

```ts
config.unsubscribe(): void
```

Removes this config's message handler from the shared pub/sub dispatcher.

## `close()`

```ts
config.close(): Promise<void>
```

Marks the config closed, unsubscribes, clears the refresh timer, and removes it from the global dynamic config registry.

## `stringifyField` and `parseField`

```ts
config.stringifyField(type, value): string;
config.parseField(type, value): string | number | boolean;
```

Helpers used internally for Valkey storage and pub/sub messages.

## `dynamicConfigs`

```ts
import { dynamicConfigs } from "valkyries";
```

Array of live `DynamicConfig` instances. It is used by `closeValkeyClients()` to close configs during shutdown.
