## 2026-05-22 - Prevent Event Loop Blocking in Dynamic Config Parsing

**Learning:** Parsing extremely large configuration maps synchronously blocks the Node.js event loop, preventing the processing of other I/O events for significant periods of time (e.g., ~400ms for 200,000 fields).
**Action:** When iterating over large data structures to apply configuration or state, use `setImmediate` periodically (e.g., every 1000 items) to explicitly yield to the event loop.

## 2024-05-22 - Avoid wrapper Promises in hot loops
**Learning:** Using `Promise.resolve().then(() => obj.close())` inside mapping operations adds microtask overhead and allocates unnecessary intermediate Promise wrappers.
**Action:** Replace wrapper Promises with a synchronous `try/catch` wrapper (like `safeClose`) that synchronously executes the function and only returns `Promise.reject(error)` upon synchronous exception. This reduces execution time significantly in hot loops or during massive bulk operations (e.g., shutting down 100k clients).

## 2024-05-18 - Concurrent chunk processing for Valkey

**Learning:** Sending operations (like BF.MADD) on arrays sequentially using `previous = previous.then()` within batched streams forces O(N) network round-trips to the Redis/Valkey cache server, degrading performance when loading streams.
**Action:** When performing commutative batch insertions to Valkey (like Bloom filter adds), replace sequential promise chains with concurrent processing (using `Promise.all` or bounded concurrency) to pipeline commands and reduce wall-clock latency via pipelining/overlap. Ensure all in-flight operations settle before cleaning up or returning to avoid race conditions and preserve deterministic outcomes.

## 2023-10-25 - [Iteration Optimization] Avoid intermediate allocations with Object.entries

**Learning:** Iterating over object fields using `Object.entries(obj)` allocates an array containing all key-value tuples, which can negatively impact performance and cause GC pressure if called frequently in hot paths.
**Action:** Use a simple `for...in` loop instead of `Object.entries(obj)` when iterating over simple records or objects to avoid unnecessary allocations, while verifying object properties when needed.

## 2026-05-22 - Array.from Generator Iteration Speed in V8

**Learning:** Using `Array.from` with a generator and mapping function is not strictly faster than a traditional `for...of` loop with `.push()` in the current Node.js/V8 environment. Benchmarking showed the traditional loop to be faster for simple generator iteration.
**Action:** When optimizing loop constructs, always write a targeted benchmark to verify performance assumptions in the target environment, as engine optimizations evolve and syntactic sugar (like `Array.from`) does not automatically equate to better performance for all input types (like generators vs arrays).

## 2024-05-22 - Single-pass Record Population for Fields

**Action:** When standard object-map access is sufficient, iterate through verified `hgetall` entries once, validate object shape per entry, and set them directly on a plain object to balance performance and resilience.
**Action:** When standard object-map access is sufficient, iterate through verified `hgetall` entries once, validate object shape per entry, and set them directly on a plain object to balance performance and resilience.

## 2023-10-25 - [Iteration Optimization] Avoid intermediate allocations with Object.entries

**Learning:** Iterating over object fields using `Object.entries(obj)` allocates an array containing all key-value tuples, which can negatively impact performance and cause GC pressure if called frequently in hot paths.
**Action:** Use a simple `for...in` loop instead of `Object.entries(obj)` when iterating over simple records or objects to avoid unnecessary allocations, while verifying object properties when needed.

## 2024-06-25 - Avoid Set spreading for array deduplication

**Learning:** Using `[...new Set(array)]` or `Set.values()` to deduplicate elements forces the use of the iterator protocol, which creates unnecessary overhead, especially for small arrays. For very small arrays (e.g. length <= `REFRESH_ALIAS_DEDUPE_THRESHOLD`, currently 30), a simple `for` loop with `Array.prototype.includes()` is significantly faster because it avoids allocating the `Set` object entirely.
**Action:** When deduplicating elements in performance-critical code, use a hybrid approach: for small arrays, use a standard `for` loop with `Array.prototype.includes()`. For larger arrays, use a `Set` to track seen elements to maintain O(N) complexity, but manually `.push()` unique elements to a results array to avoid the iterator and spread operator overhead. Also, prefer standard `for (let i = 0; i < len; i++)` loops over `for...of` loops to bypass iterator allocation.
