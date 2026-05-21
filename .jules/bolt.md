## 2024-05-18 - Concurrent chunk processing for Valkey

**Learning:** Sending operations (like BF.MADD) on arrays sequentially using `previous = previous.then()` within batched streams forces O(N) network round-trips to the Redis/Valkey cache server, degrading performance when loading streams.
**Action:** When performing commutative batch insertions to Valkey (like Bloom filter adds), replace sequential promise chains with concurrent processing (using `Promise.all` or bounded concurrency) to pipeline commands and reduce wall-clock latency via pipelining/overlap. Ensure all in-flight operations settle before cleaning up or returning to avoid race conditions and preserve deterministic outcomes.

## 2025-05-21 - Avoid Array.flatMap in hot paths

**Learning:** `Array.flatMap` creates intermediate arrays (like `[val]` or `[]`) and closure allocations for every element, introducing significant garbage collection (GC) pressure and CPU overhead in hot paths compared to manual iterations. Our benchmarks show standard `for` loops can be 2-3x faster and far more memory-efficient when building cached keys or filtering entities in batches.
**Action:** When filtering or mapping arrays in high-frequency operations (e.g. batch caching, cache key serialization), use standard `for` loops with manual array `push` instead of `flatMap`.
