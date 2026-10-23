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

The shared subscription client uses a 2-second native connection timeout and a per-attempt creation deadline (`VALKEY_SUBSCRIPTION_CREATION_TIMEOUT_MS`, default 5 seconds). A creation that rejects or reaches the deadline is retried up to `VALKEY_SUBSCRIPTION_CREATION_ATTEMPTS` total attempts (default 3), with exponential backoff starting at 1 second and capped at 5 seconds. A failure that will be retried is emitted as a Node process warning of type `ValkeySubscriptionWarning` (see `process.on("warning")`), not through the Valkey error handler, so a slow attempt followed by a successful retry never reports an error. The timeout message names the attempt and how long the deadline actually took to fire; a value well above the deadline points at event-loop starvation rather than a stalled connection. A client that finishes creation after its deadline is closed rather than retained, with a warning that gives its real creation time; a native failure that arrives after the deadline is also a warning. Only the final failure when attempts run out goes to the Valkey error handler; if shutdown stops retries, the rejection is reported once by `closeValkeyClients()` instead. Once attempts run out, the cached attempt is cleared and callers receive the last attempt's error; a later explicit call can start a new attempt. Shutdown stops further retries. Retries do not cancel an unresolved native creation operation.

With the defaults, `waitForInitialization()` can wait about 18 seconds (3 × 5 seconds plus 1 + 2 seconds of backoff) before it rejects. Applications that treat that rejection as fatal still exit once retries run out.

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

## `getBoundedPositiveIntegerField(config, field, limits)`

```ts
import { getBoundedPositiveIntegerField } from "valkyries/dynamic-config";

const batchSize = getBoundedPositiveIntegerField(flags, "batchSize", {
  defaultValue: 100,
  maxValue: 1000,
});
```

Reads a numeric field from `config.fields` and returns it only when it is an integer greater than `0` and at most `limits.maxValue`. Otherwise it returns `limits.defaultValue`.

A missing field, a non-number, a non-integer, `0`, a negative number, and a value above `maxValue` all fall back to `defaultValue`. Values above `maxValue` are treated as invalid and are never clamped to the maximum.

`config` only needs a `fields` map, so any `DynamicConfig` instance works.

## Namespaces and Update Validation

These helpers validate untrusted updates, such as admin edits, before they reach `setFields()`. They are pure: they never read or write Valkey, and they only read `config.fieldTypes`. Authorization, audit history, and response shapes stay in the application.

```ts
import {
  createDynamicConfigRegistry,
  defineDynamicConfigNamespace,
  validateDynamicConfigUpdate,
  validateStrictlyAscending,
} from "valkyries/dynamic-config";

const registry = createDynamicConfigRegistry([
  defineDynamicConfigNamespace({
    namespace: "limits",
    config: limits, // a DynamicConfig
    fields: {
      soft: { minValue: 1, integer: true, description: "Soft limit" },
      hard: { minValue: 1, maxValue: 1000, integer: true },
    },
    validate: (next) => validateStrictlyAscending(next, ["soft", "hard"]),
  }),
]);

const entry = registry.get("limits");
if (entry) {
  await entry.config.waitForInitialization();
  const update = validateDynamicConfigUpdate(entry, entry.config.getFields(), requestBody);
  if (update.changed) await entry.config.setFields(update.changes);
}
```

### `defineDynamicConfigNamespace(definition)`

Returns `definition` unchanged. Throws when `fields` does not have exactly one entry per `config.fieldTypes` key, which catches rules that have drifted from the config schema. Definitions may carry extra application properties, such as labels or access policy. Those properties keep their types through the registry.

```ts
type DynamicConfigNamespaceDefinition = {
  namespace: string;
  config: { fieldTypes: Record<string, "string" | "number" | "boolean"> };
  fields: Record<string, DynamicConfigFieldRules>;
  validate?: (next: Record<string, string | number | boolean>) => void;
};

type DynamicConfigFieldRules = {
  description?: string;
  minValue?: number; // inclusive, number fields
  maxValue?: number; // inclusive, number fields
  maxValueExemption?: string; // why a number field has no maxValue
  integer?: boolean; // number fields must be safe integers
};
```

### `withMaxValueExemption(fields, reason, except?)`

Returns a copy of `fields` that sets `maxValueExemption: reason` on every field without a `maxValue`, skipping the names in `except`.

### `createDynamicConfigRegistry(entries)`

Returns `{ entries, get(namespace) }`. `get` returns `null` for unknown namespaces. Throws on duplicate namespaces.

### `validateDynamicConfigUpdate(definition, current, changes)`

Validates `changes` against the definition and returns `{ changes, next, changed }`. `changes` holds the validated values, `next` is `current` merged with `changes`, and `changed` is true when any requested value differs from `current`. Throws `DynamicConfigValidationError` when:

- `changes` is not a non-empty plain object
- a field name is not in `config.fieldTypes`
- a value does not already have the field's declared type (`boolean`, `string`, or a finite `number`)
- a number breaks the field's `integer`, `minValue`, or `maxValue` rule

After those checks it runs the definition's `validate` hook on `next`. The hook may throw any error.

Unlike `setFields()`, it does not coerce values. For example, `"3"` is rejected for a number field and `"true"` is rejected for a boolean field.

### `getChangedFields(previous, next)`

Shallow diff of two field snapshots: `Record<string, { previous, next }>`. A missing key reads as `undefined`, and `null` or `undefined` snapshots are treated as empty.

### Validators

Use these inside a `validate` hook. Each one throws `DynamicConfigValidationError`.

- `validatePositiveNumberFields(next)`: every number field must be finite and greater than 0.
- `validatePositiveIntegerFields(next)`: every number field must be an integer greater than 0.
- `validateNumberRange(next, field, min, max)`: `next[field]` must be a finite number in `[min, max]`.
- `validateOneOf(next, field, allowed)`: `next[field]` must be one of the `allowed` strings.
- `validateStrictlyAscending(next, fields)`: the named fields must be numbers in strictly ascending order.
