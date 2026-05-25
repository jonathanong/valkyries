import { emitValkeyEvent } from "../events.mts";
import { Batch, TimeUnit, type GlideString } from "@valkey/valkey-glide";
import { handleValkeyError } from "../errors.mts";
import { ValkeyCacheTypeError, durationInMilliseconds } from "../cache-utils.mts";
import { trackCacheCall } from "../cache-metrics.mts";
import { cacheSetIfNotInvalidatedScript } from "./constants.mts";
import { ValkeyCacheBatchRead } from "./batch-read.mts";
import { emitSetIfNotInvalidatedEvents } from "./set-if-not-invalidated-events.mts";

const REFRESH_ALIAS_DEDUPE_THRESHOLD = 15;

export abstract class ValkeyCacheMutations<K = string> extends ValkeyCacheBatchRead<K> {
  async refreshById<T>(
    aliases: K[],
    fetchByKey: (key: K) => Promise<T | null | undefined>,
  ): Promise<T | null> {
    const aliasState = this.collectRefreshAliases(aliases);
    if (aliasState.firstValidAlias === null) return null;
    const start = process.hrtime.bigint();
    try {
      const result = await fetchByKey(aliasState.firstValidAlias);
      const normalizedResult = result ?? null;
      const serialized = await this.serializeRefreshResult(normalizedResult);
      const ttl = normalizedResult === null ? this.nullTtl : this.ttl;
      const batch = new Batch(false);
      for (const key of aliasState.serializedKeys) {
        batch.set(this.getSerializedCacheKey(key), serialized, {
          expiry: { type: TimeUnit.Seconds, count: ttl },
        });
      }
      try {
        await this.client.exec(batch, true);
        emitValkeyEvent("cache:set", { cacheName: this.prefix, keys: aliasState.serializedKeys });
      } catch (cause) {
        handleValkeyError(cause);
      }
      return normalizedResult;
    } finally {
      trackCacheCall({
        cacheName: this.prefix,
        batch: false,
        hits: 0,
        misses: 1,
        bloomMisses: 0,
        duration: durationInMilliseconds(start),
      });
    }
  }

  set(key: K, value: unknown, ttl?: number) {
    const serializedKey = this.toSerializedKey(key);
    if (serializedKey === null) return Promise.resolve();
    return this.setBySerializedKey(serializedKey, value, ttl);
  }

  async setBatch(entries: Array<{ key: K; value: unknown; ttl?: number }>): Promise<void> {
    const validEntries = this.withSerializedKeys(entries);
    if (validEntries.length === 0) return;
    const serializationResults = await Promise.allSettled(
      validEntries.map((entry) => this.serializeValue(entry.value)),
    );
    const batch = new Batch(false);
    const writtenKeys: string[] = [];
    for (let i = 0; i < validEntries.length; i++) {
      const result = serializationResults[i];
      if (result.status === "rejected") {
        this.handleSerializationFailure(result.reason);
        continue;
      }
      const entry = validEntries[i];
      batch.set(this.getSerializedCacheKey(entry.serializedKey), result.value, {
        expiry: { type: TimeUnit.Seconds, count: this.entryTtl(entry) },
      });
      writtenKeys.push(entry.serializedKey);
    }
    if (writtenKeys.length === 0) return;
    try {
      await this.client.exec(batch, true);
    } catch (cause) {
      handleValkeyError(cause);
      throw cause;
    }
    emitValkeyEvent("cache:set", { cacheName: this.prefix, keys: writtenKeys });
  }

  protected async setBySerializedKey(
    serializedKey: string,
    value: unknown,
    ttl?: number,
  ): Promise<void> {
    try {
      const serialized = await this.serializeValue(value);
      await this.setSerializedValue(serializedKey, serialized, ttl);
      emitValkeyEvent("cache:set", { cacheName: this.prefix, keys: [serializedKey] });
    } catch (cause) {
      this.handleSerializationFailure(cause);
    }
  }

  protected async setBySerializedKeyIfNotInvalidated(
    serializedKey: string,
    value: unknown,
    ttl?: number,
  ): Promise<void> {
    try {
      const serialized = await this.serializeValue(value);
      await this.setSerializedEntriesIfNotInvalidated([{ serializedKey, value: serialized, ttl }]);
    } catch (cause) {
      this.handleSerializationFailure(cause);
    }
  }

  protected async setBatchIfNotInvalidated(
    entries: Array<{ key: K; value: unknown; ttl?: number }>,
  ): Promise<void> {
    const validEntries = this.withSerializedKeys(entries);
    if (validEntries.length === 0) return;
    const serializationResults = await Promise.allSettled(
      validEntries.map((entry) => this.serializeValue(entry.value)),
    );
    const setEntries: Array<{ serializedKey: string; value: string | Buffer; ttl?: number }> = [];
    for (let i = 0; i < validEntries.length; i++) {
      const result = serializationResults[i];
      if (result.status === "rejected") {
        this.handleSerializationFailure(result.reason);
        continue;
      }
      const entry = validEntries[i];
      setEntries.push({
        serializedKey: entry.serializedKey,
        value: result.value,
        ttl: this.entryTtl(entry),
      });
    }
    await this.setSerializedEntriesIfNotInvalidated(setEntries);
  }

  private setSerializedValue(serializedKey: string, serialized: string | Buffer, ttl?: number) {
    return this.client.set(this.getSerializedCacheKey(serializedKey), serialized, {
      expiry: { type: TimeUnit.Seconds, count: ttl != null && ttl > 0 ? ttl : this.ttl },
    });
  }

  private async setSerializedEntriesIfNotInvalidated(
    entries: Array<{ serializedKey: string; value: string | Buffer; ttl?: number }>,
  ): Promise<void> {
    if (entries.length === 0) return;
    const keys = [
      ...entries.map((entry) => this.getSerializedCacheKey(entry.serializedKey)),
      ...entries.map((entry) => this.getSerializedInvalidationKey(entry.serializedKey)),
    ];
    const args: GlideString[] = [String(entries.length)];
    for (const entry of entries) {
      args.push(String(entry.ttl != null && entry.ttl > 0 ? entry.ttl : this.ttl));
      args.push(entry.value);
    }
    const results = await this.client.invokeScript(cacheSetIfNotInvalidatedScript, {
      keys,
      args,
    });
    emitSetIfNotInvalidatedEvents(this.prefix, entries, results);
  }

  private collectRefreshAliases(aliases: K[]) {
    const len = aliases.length;
    if (len === 0) return { firstValidAlias: null, serializedKeys: [] };

    let firstValidAlias: K | null = null;
    let firstSerialized: string | null = null;

    for (let i = 0; i < len; i++) {
      const serialized = this.toSerializedKey(aliases[i]);
      if (serialized === null) continue;
      firstValidAlias = aliases[i];
      firstSerialized = serialized;
      break;
    }

    if (firstValidAlias === null || firstSerialized === null)
      return { firstValidAlias, serializedKeys: [] };

    const serializedKeys: string[] = [firstSerialized];

    // ⚡ Bolt Optimization:
    // Split alias dedupe between Set and includes at threshold to avoid per-iteration branching
    // and O(N^2) includes checks for arrays with more than 15 entries.
    const useSet = len > REFRESH_ALIAS_DEDUPE_THRESHOLD;
    if (useSet) {
      const seenSet = new Set([firstSerialized]);
      for (let i = 0; i < len; i++) {
        const serialized = this.toSerializedKey(aliases[i]);
        if (serialized === null || seenSet.has(serialized)) continue;
        seenSet.add(serialized);
        serializedKeys.push(serialized);
      }
    } else {
      for (let i = 0; i < len; i++) {
        const serialized = this.toSerializedKey(aliases[i]);
        if (serialized === null || serializedKeys.includes(serialized)) continue;
        serializedKeys.push(serialized);
      }
    }
    return { firstValidAlias, serializedKeys };
  }

  private async serializeRefreshResult(value: unknown): Promise<string | Buffer> {
    try {
      return await this.serializeValue(value);
    } catch (cause) {
      if (cause instanceof ValkeyCacheTypeError) throw cause;
      throw new Error("ValkeyCache: failed to stringify and/or compress value", { cause });
    }
  }

  private withSerializedKeys(entries: Array<{ key: K; value: unknown; ttl?: number }>) {
    const result: Array<{ key: K; value: unknown; ttl?: number; serializedKey: string }> = [];
    // ⚡ Bolt Optimization:
    // What: Use an indexed loop for serialized-key filtering.
    // Why: Avoids iterator overhead in this dense-array hot path.
    // Impact: Reduces GC pressure and improves throughput for batch operations.
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const serializedKey = this.toSerializedKey(entry.key);
      if (serializedKey !== null) {
        result.push({ ...entry, serializedKey });
      }
    }
    return result;
  }

  private entryTtl(entry: { value: unknown; ttl?: number }): number {
    if (entry.ttl != null && entry.ttl > 0) return entry.ttl;
    return entry.value === null || entry.value === undefined ? this.nullTtl : this.ttl;
  }

  private handleSerializationFailure(cause: unknown) {
    if (cause instanceof ValkeyCacheTypeError) throw cause;
    handleValkeyError(cause instanceof Error ? cause : new Error(String(cause)));
  }
}
