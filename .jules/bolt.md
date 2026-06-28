## 2026-06-07 - Pre-compute and Map Object Configuration in Constructor for Loop Optimization
**Learning:** In hot path loops, performing dictionary lookups (`fieldTypes[name]` and `defaultFields[name]`) on every iteration inside methods like `buildMissingDefaultWrites` or `applyFieldsFromMap` is a performance bottleneck.
**Action:** Pre-compute the merged configuration state as an array of objects during class instantiation so the methods can iterate natively over the array properties without using `Object.keys()` and without repeatedly accessing the parent dictionaries.

## 2026-06-07 - Pre-allocate Arrays over Spread & Map in Batch Invalidation
**Learning:** In hot batch paths (like Valkey cache invalidation mappings where cache and invalidation keys are derived from the same source entries), constructing arrays by spreading multiple `.map()` results (e.g. `[...entries.map(f1), ...entries.map(f2)]`) introduces significant iterator overhead and repeated array resizing/cloning.
**Action:** When creating dense structured arrays from an input list in performance-critical paths, pre-allocate the final array (e.g., `new Array(len * 2)`) and use a single indexed `for` loop to populate elements directly to minimize GC pressure and improve throughput. Use `// eslint-disable-next-line unicorn/no-new-array` if needed.

## 2026-06-10 - Pre-allocate Arrays over Map in Batch Read
**Learning:** In the cache batch-read hot path, mapping cached entries to values and creating set-entries arrays via `.map()` introduces significant iterator closure overhead and dynamic array resizing.
**Action:** When creating dense structured arrays in performance-critical batch paths, pre-allocate the final array (e.g., `new Array(len)`) and use a single indexed `for` loop to populate elements directly to minimize GC pressure and improve throughput. Use `// eslint-disable-next-line unicorn/no-new-array` if needed.

## 2024-06-14 - [V8 Array Pre-allocation Optimization]
**Learning:** Setting `.length` on an empty array (`const arr = []; arr.length = len;`) is a severe performance anti-pattern in V8 (Node.js). It forces the engine to transition the dense array into a dictionary/holey array backing store (`HOLEY_ELEMENTS`), which degrades memory access and iteration speeds compared to just using `.map()`.
**Action:** When pre-allocating arrays for performance optimizations, ALWAYS use `new Array(len)` and suppress the linting rule with `// eslint-disable-next-line unicorn/no-new-array`. Never set `.length` on an empty array in a hot path.
