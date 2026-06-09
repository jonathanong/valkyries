## 2026-06-07 - Pre-compute and Map Object Configuration in Constructor for Loop Optimization
**Learning:** In hot path loops, performing dictionary lookups (`fieldTypes[name]` and `defaultFields[name]`) on every iteration inside methods like `buildMissingDefaultWrites` or `applyFieldsFromMap` is a performance bottleneck.
**Action:** Pre-compute the merged configuration state as an array of objects during class instantiation so the methods can iterate natively over the array properties without using `Object.keys()` and without repeatedly accessing the parent dictionaries.

## 2026-06-09 - Avoid Map and Spread Operators for Bulk Array Merging
**Learning:** In hot batch processing methods like `setSerializedEntriesIfNotInvalidated`, using spread syntax with `.map()` over the same array multiple times (`[...entries.map(f1), ...entries.map(f2)]`) allocates multiple intermediate arrays and incurs significant iterator overhead, creating GC pressure.
**Action:** When merging mapped elements from a single source array, replace multiple `.map()` and spread calls with a single pre-allocated array (`new Array(len * 2)`) populated via an indexed `for` loop.
