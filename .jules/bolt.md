## 2024-05-18 - Concurrent chunk processing for Valkey

**Learning:** Sending operations (like BF.MADD) on arrays sequentially using `previous = previous.then()` within batched streams forces O(N) network round-trips to the Redis/Valkey cache server, degrading performance when loading streams.
**Action:** When performing commutative batch insertions to Valkey (like Bloom filter adds), replace sequential promise chains with concurrent processing (using `Promise.all` or bounded concurrency) to pipeline commands and reduce wall-clock latency via pipelining/overlap. Ensure all in-flight operations settle before cleaning up or returning to avoid race conditions and preserve deterministic outcomes.
