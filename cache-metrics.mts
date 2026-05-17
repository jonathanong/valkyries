import { emitValkeyEvent } from "./events.mts";

export type CacheCallMetric = {
  cacheName: string;
  batch: boolean;
  hits: number;
  misses: number;
  bloomMisses: number;
  duration: number;
};

export function trackCacheCall(metric: CacheCallMetric): void {
  emitValkeyEvent("cache:call", {
    cacheName: metric.cacheName,
    batch: metric.batch,
    hits: metric.hits,
    misses: metric.misses,
    bloomMisses: metric.bloomMisses,
    durationMs: metric.duration,
  });
}
