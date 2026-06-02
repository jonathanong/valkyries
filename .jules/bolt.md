## 2026-05-28 - In-Place Batch Merge Mutation
**Learning:** In the `cache/batch-read.mts` file, `mergeFetchedResults` previously cloned the intermediate cached values array using the spread operator (`[...cachedValues]`) before merging in newly fetched results. This incurred unnecessary array allocation and garbage collection overhead in the hot path.
**Action:** When merging fetched batch results into a temporary intermediate array, avoid using spread operators if the array is safely ephemeral; mutate in place via an indexed loop to lower GC pressure and memory allocation.

## 2026-05-25 - Flush concurrent deletes before continuing with delete-by-prefix
**Learning:** When collecting asynchronous operations (like Valkey `unlink`) inside a scan loop, unbounded arrays can grow quickly and rejected promises can surface after control leaves the loop, changing failure timing and observability.
**Action:** Buffer unlink promises, cap work in batches, and flush in batches as promises settle via `Promise.all()` over wrapped results, so all in-flight operations are observed before reporting a broader failure. Handle rejection reasons through `handleValkeyError` while keeping errors from escaping mid-loop, and avoid `catch(() => {})` swallow patterns that hide unlink failures.
## 2026-05-26 - Optimize cache batch read array allocation
**Learning:** In highly trafficked batching pipelines (like `cacheGetByAnyBatch` combining missing fetches and cache hits), using intermediate arrays is common. However, explicitly cloning those arrays inside mapping/reduction loops (e.g. `[...cachedValues]`) when the scope is tightly constrained can introduce O(N) heap allocations for every batch. In the same codepath, merging cache metadata and checks through a temporary boolean variable is also avoidable.
**Action:** Mutate tightly-scoped intermediate arrays in place rather than spreading to clone. Evaluate explicit values directly in the `if` condition when possible instead of creating separate primitive tracking variables.

## 2025-02-09 - Pre-allocate Arrays over `.map()`
**Learning:** In hot batch paths (like Valkey cache invalidation mappings), `.map()` introduces unnecessary iterator overhead and array resizing.
**Action:** When a dense mapping over an array is needed in a performance-critical path, allocate the output array up front using `new Array(len)` and use a traditional indexed `for` loop to write the values. Use `// eslint-disable-next-line unicorn/no-new-array` to bypass lint warnings if needed.
