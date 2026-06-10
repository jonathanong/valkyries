import { ValkeyCacheDeletes } from "./cache/deletes.mts";
export type { ValkeyCacheDeleteFromCachesEntry } from "./cache/deletes.mts";
export { multiCacheGetByAnyBatch } from "./cache/multi-batch-read.mts";

export class ValkeyCache<K = string> extends ValkeyCacheDeletes<K> {}
