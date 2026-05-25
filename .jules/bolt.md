
## 2026-05-25 - Flush concurrent deletes before continuing with delete-by-prefix
**Learning:** When collecting asynchronous operations (like Valkey `unlink`) inside a scan loop, unbounded arrays can grow quickly and rejected promises can surface after control leaves the loop, changing failure timing and observability.
**Action:** Buffer unlink promises, cap work in batches, and flush in batches as promises settle via `Promise.all()` over wrapped results, so all in-flight operations are observed before reporting a broader failure. Handle rejection reasons through `handleValkeyError` while keeping errors from escaping mid-loop, and avoid `catch(() => {})` swallow patterns that hide unlink failures.

## 2026-05-25 - V8 Array Initialization Micro-optimization
**Learning:** In hot paths, V8 handles array initialization faster when pre-allocating using `new Array(size)` rather than modifying the `.length` property of an empty array (`const arr = []; arr.length = size;`), yielding a ~9% throughput improvement. However, manually unrolling `Array.prototype.filter(Boolean).map(...)` into `for` loops in an attempt to reduce intermediate garbage collection can surprisingly *reduce* performance in V8, contrary to expectations.
**Action:** When pre-allocating arrays, prefer `new Array(size)` and suppress the `unicorn/no-new-array` ESLint rule, but do not blindly rewrite native functional array methods into manual loops without benchmarking first.
