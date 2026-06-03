# Repository Guidance

## Valkey Performance Principles

- Minimize network round trips. Prefer one Lua script or one native batch command over multiple sequential Valkey commands when the operations are part of one logical action.
- Minimize inflight requests. Prefer batched APIs and chunked bulk operations over per-item loops, especially in worker or backfill paths.
- Keep Lua scripts generic. Put reusable primitives in `scripts/` and app-specific policy, key naming, and thresholds in the caller.
- Preserve Redis Cluster safety. Multi-key scripts must use compatible hash tags, and public APIs should validate that requirement before invoking Valkey.
- Keep bounded concurrency explicit. Any fan-out over command chunks should have a conservative default and a caller option when different workloads need lower pressure.
- Treat cache refresh-ahead as optional load. Background refreshes improve latency for user paths, but workers and batch jobs should be able to suppress them when request count matters more.
- Fail open only when the API contract says so. If a read-through cache or rate limiter falls back on Valkey errors, report the error and document the consistency tradeoff.
- Do not upstream application lifecycle glue. Queue shutdown ordering, analytics, app error routing, and service-specific keys belong in applications unless they are made generic first.

