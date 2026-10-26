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
    const sentinel = this.markRefreshesPending(staleSerializedKeys);
    this.startBackgroundRefresh(staleSerializedKeys, sentinel, () =>
      this.refreshBatch(staleKeys, batchFn),
    );
  }

  protected refreshStaleEntry(
    serializedKey: string,
    ttlSecondsRemaining: number | null,
    fetchValue: () => Promise<unknown>,
  ) {
    if (!this.shouldRefreshTtl(ttlSecondsRemaining)) return;
    if (this.refreshPromises.has(serializedKey)) return;
    const sentinel = this.markRefreshesPending([serializedKey]);
    this.startBackgroundRefresh([serializedKey], sentinel, () =>
      this.refreshSingle(serializedKey, fetchValue),
    );
  }

  private markRefreshesPending(serializedKeys: string[]) {
    const sentinel = Promise.resolve();
    for (const key of serializedKeys) this.refreshPromises.set(key, sentinel);
    return sentinel;
  }

  /**
   * Hands a detached refresh to runBackgroundRefresh. The refresh reports its own errors and runs
   * at most once. A wrapper that throws or rejects is reported and never rejects the caller's read.
   * The pending markers stay set until a started refresh settles, or until the wrapper settles
   * without starting one, and are only cleared if no newer refresh has replaced them.
   */
  private startBackgroundRefresh(
    serializedKeys: string[],
    sentinel: Promise<void>,
    run: () => Promise<void>,
  ) {
    const clearPending = () => {
      for (const key of serializedKeys) {
        if (this.refreshPromises.get(key) === sentinel) this.refreshPromises.delete(key);
      }
    };
    let refreshPromise: Promise<void> | undefined;
    const refresh = () => (refreshPromise ??= run().catch(handleValkeyError).finally(clearPending));
    let wrapped: Promise<void>;
    try {
      wrapped = Promise.resolve(this.runBackgroundRefresh(refresh));
    } catch (error) {
      wrapped = Promise.reject(error);
    }
    wrapped.catch(handleValkeyError).finally(() => {
      if (!refreshPromise) clearPending();
    });
  }

  private async refreshBatch<T>(
    keys: K[],
    batchFn: (keys: K[]) => Promise<Array<T | null | undefined>>,
  ) {
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
  }

  private async refreshSingle(serializedKey: string, fetchValue: () => Promise<unknown>) {
    const result = await fetchValue();
    if (result === undefined || result === null) {
      await this.setBySerializedKeyIfNotInvalidated(serializedKey, null, this.nullTtl);
      return;
    }
    await this.setBySerializedKeyIfNotInvalidated(serializedKey, result);
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
