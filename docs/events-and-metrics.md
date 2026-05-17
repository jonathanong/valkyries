# Events And Metrics

Subscribe to `valkeyEvents` for observability.

Events include cache hits/misses, cache writes/deletes, Bloom filter checks/writes, rate limiter operations, and `cache:call` metric payloads.

Errors from background work are sent to the package error handler. Configure it with:

```ts
import { setValkeyErrorHandler } from "valkyries";

setValkeyErrorHandler((error) => {
  logger.error(error);
});
```

## `valkeyEvents`

```ts
import { valkeyEvents } from "valkyries";
```

`valkeyEvents` is a typed `EventEmitter`.

Example:

```ts
valkeyEvents.on("cache:call", (event) => {
  metrics.histogram("cache.call.duration", event.durationMs, {
    cache: event.cacheName,
    batch: String(event.batch),
  });
});
```

## `emitValkeyEvent(event, payload)`

```ts
emitValkeyEvent<K extends keyof ValkeyEventMap>(
  event: K,
  ...args: ValkeyEventMap[K]
): void
```

Emits an event and routes listener errors to the configured Valkey error handler.

## Event Payloads

Cache events:

```ts
"cache:call": [{
  cacheName: string;
  batch: boolean;
  hits: number;
  misses: number;
  bloomMisses: number;
  durationMs: number;
}];
"cache:hit": [{ cacheName: string; keys: string[]; count: number }];
"cache:miss": [{ cacheName: string; keys: string[]; count: number }];
"cache:bloom-miss": [{ cacheName: string; keys: string[]; count: number }];
"cache:set": [{ cacheName: string; keys: string[] }];
"cache:set-skipped": [{ cacheName: string; keys: string[] }];
"cache:delete": [{ cacheName: string; keys: string[] }];
"cache:invalidate": [{ cacheName: string }];
```

Bloom filter events:

```ts
"bloom-filter:exists": [{ name: string; item: string; result: boolean | null }];
"bloom-filter:mexists": [{
  name: string;
  items: string[];
  results: Array<boolean | null>;
}];
"bloom-filter:add": [{ name: string; items: string[] }];
```

Rate limiter events:

```ts
"rate-limiter:add": [{ prefix: string; ids: string[] }];
"rate-limiter:get": [{ prefix: string; ids: string[]; counts: number[] }];
"rate-limiter:delete": [{ prefix: string; ids: string[] }];
"rate-limiter:invalidate": [{ prefix: string }];
```

## `trackCacheCall(metric)`

```ts
trackCacheCall(metric: {
  cacheName: string;
  batch: boolean;
  hits: number;
  misses: number;
  bloomMisses: number;
  duration: number;
}): void
```

Emits `cache:call` with `duration` renamed to `durationMs`.

## Error Handling

```ts
setValkeyErrorHandler(handler: (error: Error) => void): void
handleValkeyError(error: unknown): void
```

`setValkeyErrorHandler()` installs the process-wide handler used for asynchronous write failures, event listener failures, background refresh failures, and other non-fatal Valkey errors.

`handleValkeyError()` normalizes any thrown value to an `Error` and passes it to the configured handler.
