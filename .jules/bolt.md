
## 2026-05-25 - Flush concurrent deletes before continuing with delete-by-prefix
**Learning:** When collecting asynchronous operations (like Valkey `unlink`) inside a scan loop, unbounded arrays can grow quickly and rejected promises can surface after control leaves the loop, changing failure timing and observability.
**Action:** Buffer unlink promises, cap work in batches, and flush in batches as promises settle via `Promise.all()` over wrapped results, so all in-flight operations are observed before reporting a broader failure. Handle rejection reasons through `handleValkeyError` while keeping errors from escaping mid-loop, and avoid `catch(() => {})` swallow patterns that hide unlink failures.
