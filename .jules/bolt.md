## 2024-05-18 - Concurrent chunk processing for Valkey

**Learning:** Sending operations (like BF.MADD) on arrays sequentially using `previous = previous.then()` within batched streams forces O(N) network round-trips to the Redis/Valkey cache server, degrading performance when loading streams.
**Action:** When performing commutative batch insertions to Valkey (like Bloom filter adds), replace sequential promise chains with concurrent processing (using `Promise.all` or bounded concurrency) to pipeline commands and reduce wall-clock latency via pipelining/overlap. Ensure all in-flight operations settle before cleaning up or returning to avoid race conditions and preserve deterministic outcomes.

## 2023-10-25 - [Iteration Optimization] Avoid intermediate allocations with Object.entries

**Learning:** Iterating over object fields using `Object.entries(obj)` allocates an array containing all key-value tuples, which can negatively impact performance and cause GC pressure if called frequently in hot paths.
**Action:** Use a simple `for...in` loop instead of `Object.entries(obj)` when iterating over simple records or objects to avoid unnecessary allocations, while verifying object properties when needed.
