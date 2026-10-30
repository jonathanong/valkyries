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

A separate Bun job runs the suite under the Bun runtime (`pnpm run test:bun`). It then runs `pnpm run test:bun-smoke` after a build. That script packs the package, installs it into a scratch Bun app, and runs a rate-limit call and a lease through a dynamically imported barrel that re-exports `valkyries` and an app module creating its own client with `export *`. Bun's bundler does not await top-level await reached that way, so this fails if the package regains one; `require("valkyries")` under Node checks the same with `ERR_REQUIRE_ASYNC_MODULE`. It runs this once under the Bun runtime and once as a `bun build --compile` executable after deleting the app's install directory.

Validation commands:

```sh
pnpm run typecheck
pnpm run build
pnpm run lint
pnpm run lint:lua
pnpm run test:coverage
pnpm run test:bun
pnpm run test:bun-smoke
```
