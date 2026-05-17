# Migration From Filaments

This package was extracted from `backend/data-stores/valkey`.

Changes from the internal module:

- `glide-mq` queue helpers are intentionally excluded.
- `@modules/on-error` is replaced by `setValkeyErrorHandler()`.
- `@data-stores/analytics` cache metrics are emitted as `cache:call` events.
- `@ts-shared/utils/strings` key normalization is local to this package.
- Classes accept optional `GlideClient` instances for dependency injection.

Most class methods and event names are otherwise preserved.
