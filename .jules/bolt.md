## 2024-05-18 - Concurrent chunk processing for Valkey

**Learning:** Sending operations (like BF.MADD) on arrays sequentially using `previous = previous.then()` within batched streams forces O(N) network round-trips to the Redis/Valkey cache server, degrading performance when loading streams.
**Action:** When performing commutative batch insertions to Valkey (like Bloom filter adds), replace sequential promise chains with concurrent `Promise.all()` to pipeline commands and reduce network latency from O(n) to O(1) round trips per batch.
