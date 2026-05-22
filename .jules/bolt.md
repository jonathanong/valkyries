## 2024-05-18 - Concurrent chunk processing for Valkey

**Learning:** Sending operations (like BF.MADD) on arrays sequentially using `previous = previous.then()` within batched streams forces O(N) network round-trips to the Redis/Valkey cache server, degrading performance when loading streams.
**Action:** When performing commutative batch insertions to Valkey (like Bloom filter adds), replace sequential promise chains with concurrent processing (using `Promise.all` or bounded concurrency) to pipeline commands and reduce wall-clock latency via pipelining/overlap. Ensure all in-flight operations settle before cleaning up or returning to avoid race conditions and preserve deterministic outcomes.

## 2024-05-22 - Replacing flatMap with for loops

**Learning:** `Array.prototype.flatMap` creates intermediate arrays during each iteration, which leads to unnecessary garbage collection overhead, especially in hot paths like caching layers (e.g. `cache/deletes.mts` or `cache/mutations.mts`).
**Action:** When working on performance-sensitive array transformations (like filtering + mapping), replace `flatMap` with standard `for...of` loops and pre-allocated arrays, or combine multiple transformations into a single indexed `for` loop pass.
