# Testing And CI

Tests use Vitest and require a Valkey instance with Bloom support.

Lua scripts in `scripts/` are linted with Selene 0.30.1. Install that version locally and make
sure `selene` is available on `PATH` before running `pnpm run lint`.

Local example:

```sh
docker run --rm -p 6379:6379 valkey/valkey-bundle:latest
pnpm run test:coverage
```

CI starts `valkey/valkey-bundle:latest` as a service and enforces 100% line, statement, branch, and function coverage.

Validation commands:

```sh
pnpm run typecheck
pnpm run build
pnpm run lint
pnpm run lint:lua
pnpm run test:coverage
```
