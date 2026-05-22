## 2024-05-18 - Concurrent chunk processing for Valkey

**Learning:** Sending operations (like BF.MADD) on arrays sequentially using `previous = previous.then()` within batched streams forces O(N) network round-trips to the Redis/Valkey cache server, degrading performance when loading streams.
**Action:** When performing commutative batch insertions to Valkey (like Bloom filter adds), replace sequential promise chains with concurrent processing (using `Promise.all` or bounded concurrency) to pipeline commands and reduce wall-clock latency via pipelining/overlap. Ensure all in-flight operations settle before cleaning up or returning to avoid race conditions and preserve deterministic outcomes.

## 2024-05-22 - Optimize map to object conversion

**Learning:** Manual iteration of map elements inside a loop using `.entries()` followed by assignments to a standard plain JS object incurs heavy performance overhead in V8 (measured around 3-4x slower locally, degrading as map size increases) vs using the native `Object.fromEntries(map)`.
**Action:** Always favor native methods like `Object.fromEntries(map)` over manual mapping iteration via loops when converting Maps to Objects to take advantage of low-level runtime engine optimizations for allocations and operations.
