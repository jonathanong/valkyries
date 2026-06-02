import type { ValkeyCacheResponse } from "../types.mts";
import { handleValkeyError } from "../errors.mts";
import { durationInMilliseconds } from "../cache-utils.mts";
import { trackCacheCall } from "../cache-metrics.mts";
import { ValkeyCacheStaleRefresh } from "./stale-refresh.mts";

export abstract class ValkeyCacheSingleRead<K = string> extends ValkeyCacheStaleRefresh<K> {
  cacheGetByAny<T>(fn: (key: K) => Promise<T | null | undefined>) {
    return async (key: K): Promise<T | null> => {
      const serializedKey = this.toSerializedKey(key);
      if (serializedKey === null) return null;
      const start = process.hrtime.bigint();
      let hits = 0;
      let misses = 0;
      let bloomMisses = 0;
      try {
        let entry: Awaited<ReturnType<typeof this.getValueWithTtl>>;
        try {
          entry = await this.getValueWithTtl(serializedKey);
        } catch (error) {
          if (!this.fallbackOnReadError) throw error;
          handleValkeyError(error);
          misses = 1;
          return (await fn(key)) ?? null;
        }
        const { value: cached, ttlSecondsRemaining, bloomMiss } = entry;
        if (bloomMiss) {
          bloomMisses = 1;
          return null;
        }
        const keyExists = ttlSecondsRemaining !== null && ttlSecondsRemaining !== -2;
        if (cached !== null && cached !== undefined) {
          hits = 1;
          this.refreshStaleEntry(serializedKey, ttlSecondsRemaining, () => fn(key));
          return cached as T;
        }
        if (keyExists) {
          hits = 1;
          return null;
        }
        misses = 1;
        const result = await fn(key);
        if (result === undefined || result === null) {
          this.setBySerializedKeyIfNotInvalidated(serializedKey, null, this.nullTtl).catch(
            handleValkeyError,
          );
          return null;
        }
        this.setBySerializedKeyIfNotInvalidated(serializedKey, result).catch(handleValkeyError);
        return result;
      } finally {
        this.trackSingleRead(start, hits, misses, bloomMisses, serializedKey);
      }
    };
  }

  invalidateCacheGetByAny(...keys: K[]) {
    return this.delete(...keys);
  }

  getKey(key: K): string {
    const serializedKey = this.toSerializedKey(key);
    if (serializedKey === null) throw new Error(`ValkeyCache: invalid key: ${String(key)}`);
    return this.getSerializedCacheKey(serializedKey);
  }

  async get(key: K): ValkeyCacheResponse {
    const serializedKey = this.toSerializedKey(key);
    if (serializedKey === null) return null;
    const { value } = await this.getValueWithTtl(serializedKey);
    return value;
  }

  protected trackSingleRead(
    start: bigint,
    hits: number,
    misses: number,
    bloomMisses: number,
    serializedKey: string,
  ) {
    trackCacheCall({
      cacheName: this.prefix,
      batch: false,
      hits,
      misses,
      bloomMisses,
      duration: durationInMilliseconds(start),
    });
    this.emitCacheEvents(
      hits > 0 ? [serializedKey] : [],
      misses > 0 ? [serializedKey] : [],
      bloomMisses > 0 ? [serializedKey] : [],
    );
  }

  abstract delete(...keys: K[]): Promise<number>;
}
