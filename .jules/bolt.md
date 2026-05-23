## 2024-05-22 - Avoid wrapper Promises in hot loops
**Learning:** Using `Promise.resolve().then(() => obj.close())` inside mapping operations adds microtask overhead and allocates unnecessary intermediate Promise wrappers.
**Action:** Replace wrapper Promises with a synchronous `try/catch` wrapper (like `safeClose`) that synchronously executes the function and only returns `Promise.reject(error)` upon synchronous exception. This reduces execution time significantly in hot loops or during massive bulk operations (e.g., shutting down 100k clients).

## 2024-05-18 - Concurrent chunk processing for Valkey

**Learning:** Sending operations (like BF.MADD) on arrays sequentially using `previous = previous.then()` within batched streams forces O(N) network round-trips to the Redis/Valkey cache server, degrading performance when loading streams.
**Action:** When performing commutative batch insertions to Valkey (like Bloom filter adds), replace sequential promise chains with concurrent processing (using `Promise.all` or bounded concurrency) to pipeline commands and reduce wall-clock latency via pipelining/overlap. Ensure all in-flight operations settle before cleaning up or returning to avoid race conditions and preserve deterministic outcomes.

## 2023-10-25 - [Iteration Optimization] Avoid intermediate allocations with Object.entries

**Learning:** Iterating over object fields using `Object.entries(obj)` allocates an array containing all key-value tuples, which can negatively impact performance and cause GC pressure if called frequently in hot paths.
**Action:** Use a simple `for...in` loop instead of `Object.entries(obj)` when iterating over simple records or objects to avoid unnecessary allocations, while verifying object properties when needed.

## 2024-05-22 - Single-pass Record Population for Fields

**Learning:** Instantiating large `Map` objects incrementally inside a `for...of` loop with repeated checks can add overhead. For `@valkey/valkey-glide`'s `hgetall` result (`{ field, value }[]`), using a single-pass loop to populate a plain object (`Record`) can avoid extra intermediate allocations while preserving defensive type checks.
**Action:** When standard object-map access is sufficient, iterate through verified `hgetall` entries once, validate shape per entry, and set them directly on a plain object to balance performance and resilience.
