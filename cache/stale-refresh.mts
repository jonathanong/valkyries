import { handleValkeyError } from "../errors.mts";
import { ValkeyCacheCore, type CacheEntry } from "./core.mts";

export abstract class ValkeyCacheStaleRefresh<K = string> extends ValkeyCacheCore<K> {
  protected refreshStaleBatchEntries<T>(
    serializedKeys: string[],
    keys: K[],
    entries: CacheEntry[],
    batchFn: (keys: K[]) => Promise<Array<T | null | undefined>>,
  ) {
    const staleSerializedKeys: string[] = [];
    const staleKeys: K[] = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.value === null || entry.value === undefined) continue;
      if (!this.shouldRefreshTtl(entry.ttlSecondsRemaining)) continue;
      if (this.refreshPromises.has(serializedKeys[i])) continue;
      staleSerializedKeys.push(serializedKeys[i]);
      staleKeys.push(keys[i]);
    }
    if (staleSerializedKeys.length === 0) return;
    this.markRefreshesPending(staleSerializedKeys);
    const refreshPromise = this.refreshBatch(staleSerializedKeys, staleKeys, batchFn);
    refreshPromise.catch(handleValkeyError);
  }

  protected refreshStaleEntry(
    serializedKey: string,
    ttlSecondsRemaining: number | null,
    fetchValue: () => Promise<unknown>,
  ) {
    if (!this.shouldRefreshTtl(ttlSecondsRemaining)) return;
    if (this.refreshPromises.has(serializedKey)) return;
    this.refreshPromises.set(serializedKey, Promise.resolve());
    const refreshPromise = this.refreshSingle(serializedKey, fetchValue);
    refreshPromise.catch(handleValkeyError);
  }

  private markRefreshesPending(serializedKeys: string[]) {
    const sentinel = Promise.resolve();
    for (const key of serializedKeys) this.refreshPromises.set(key, sentinel);
  }

  private async refreshBatch<T>(
    serializedKeys: string[],
    keys: K[],
    batchFn: (keys: K[]) => Promise<Array<T | null | undefined>>,
  ) {
    try {
      const results = await batchFn(keys);
      if (!Array.isArray(results) || results.length !== keys.length) {
        const actualResult = Array.isArray(results) ? results.length : typeof results;
        handleValkeyError(
          new Error(
            `Stale batch refresh returned invalid result: expected array of ${keys.length} items, got ${actualResult}`,
          ),
        );
        return;
      }
      const setEntries = keys.map((key, i) => {
        const value = results[i] ?? null;
        return { key, value, ttl: value === null ? this.nullTtl : undefined };
      });
      await this.setBatchIfNotInvalidated(setEntries);
    } finally {
      for (const key of serializedKeys) this.refreshPromises.delete(key);
    }
  }

  private async refreshSingle(serializedKey: string, fetchValue: () => Promise<unknown>) {
    try {
      const result = await fetchValue();
      if (result === undefined || result === null) {
        await this.setBySerializedKeyIfNotInvalidated(serializedKey, null, this.nullTtl);
        return;
      }
      await this.setBySerializedKeyIfNotInvalidated(serializedKey, result);
    } finally {
      this.refreshPromises.delete(serializedKey);
    }
  }

  protected abstract setBatchIfNotInvalidated(
    entries: Array<{ key: K; value: unknown; ttl?: number }>,
  ): Promise<void>;

  protected abstract setBySerializedKeyIfNotInvalidated(
    serializedKey: string,
    value: unknown,
    ttl?: number,
  ): Promise<void>;
}
