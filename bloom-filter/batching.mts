import { LUA_UNPACK_BATCH_SIZE } from "./scripts.mts";

export const DEFAULT_BLOOM_FILTER_CONCURRENCY_LIMIT = 16;

export function luaBatchSize(batchSize: number): number {
  return Math.min(batchSize, LUA_UNPACK_BATCH_SIZE);
}

export function* chunkItems(
  items: string[],
  batchSize: number = luaBatchSize(items.length),
): Generator<string[]> {
  if (items.length === 0) return;
  if (items.length <= batchSize) {
    yield items;
    return;
  }
  for (let i = 0; i < items.length; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    if (chunk.length > 0) yield chunk;
  }
}
