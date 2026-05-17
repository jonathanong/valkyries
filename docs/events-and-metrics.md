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
