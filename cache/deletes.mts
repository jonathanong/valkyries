import type { GlideClient } from "@valkey/valkey-glide";
import type { ValkeyCache } from "../cache.mts";
import { cacheValkeyClient } from "../clients.mts";
import { emitValkeyEvent } from "../events.mts";
import { deleteKeysWithPrefix } from "../delete.mts";
import { normalizeCountResult } from "../utils.mts";
import {
  CACHE_NAMESPACE,
  INVALIDATION_MARKER_TTL_SECONDS,
  cacheDeleteWithInvalidationScript,
} from "./constants.mts";
import { ValkeyCacheMutations } from "./mutations.mts";

export type ValkeyCacheDeleteFromCachesEntry<K = any> = {
  cache: ValkeyCache<K>;
  keys: readonly K[];
};

type ValkeyCacheDeleteFromCachesEntryImplementation = {
  cache: ValkeyCacheDeletes<any>;
  keys: readonly any[];
};

type SerializedDeleteEntry = {
  cache: ValkeyCacheDeletes<any>;
  serializedKeys: string[];
};

export class ValkeyCacheDeletes<K = string> extends ValkeyCacheMutations<K> {
  async delete(...keys: K[]): Promise<number> {
    const serializedKeys: string[] = [];
    const keyArray: string[] = [];

    // ⚡ Bolt Optimization:
    // What: Use an indexed loop for the delete key transform.
    // Why: Avoids iterator overhead while preserving the single-pass batch path.
    // Impact: Reduces allocation pressure and improves throughput for batch operations.
    for (let i = 0; i < keys.length; i++) {
      const serialized = this.toSerializedKey(keys[i]);
      if (serialized !== null) {
        serializedKeys.push(serialized);
        keyArray.push(this.getSerializedCacheKey(serialized));
      }
    }

    if (keyArray.length === 0) return 0;
    // eslint-disable-next-line unicorn/no-new-array
    const invalidationKeys = new Array(serializedKeys.length);
    for (let i = 0; i < serializedKeys.length; i++) {
      invalidationKeys[i] = this.getSerializedInvalidationKey(serializedKeys[i]);
    }
    const result = await this.client.invokeScript(cacheDeleteWithInvalidationScript, {
      keys: [...keyArray, ...invalidationKeys],
      args: [String(keyArray.length), String(INVALIDATION_MARKER_TTL_SECONDS)],
    });
    const count = normalizeCountResult(result);
    emitValkeyEvent("cache:delete", { cacheName: this.prefix, keys: serializedKeys });
    return count;
  }

  protected async deleteBySerializedKey(...serializedKeys: string[]): Promise<number> {
    const len = serializedKeys.length;
    if (len === 0) return 0;

    // ⚡ Bolt Optimization:
    // What: Pre-allocate array and use an indexed loop.
    // Why: Avoids iterator overhead and array resizing during mapping.
    // Impact: Measurably faster in internal benchmarks for larger batch delete operations, reducing GC allocation pressure.
    // eslint-disable-next-line unicorn/no-new-array
    const keyArray = new Array<string>(len);
    for (let i = 0; i < len; i++) {
      keyArray[i] = this.getSerializedCacheKey(serializedKeys[i]);
    }

    const count = await this.client.unlink(keyArray);
    emitValkeyEvent("cache:delete", { cacheName: this.prefix, keys: serializedKeys });
    return count;
  }

  invalidate() {
    return ValkeyCacheDeletes.invalidate(this.prefix, this.client);
  }

  static async deleteFromCaches<K>(
    entries: readonly ValkeyCacheDeleteFromCachesEntry<K>[],
  ): Promise<number>;
  static async deleteFromCaches(
    entries: readonly ValkeyCacheDeleteFromCachesEntry<any>[],
  ): Promise<number>;
  static async deleteFromCaches(
    entries: readonly ValkeyCacheDeleteFromCachesEntryImplementation[],
  ): Promise<number> {
    const groups = new Map<GlideClient, SerializedDeleteEntry[]>();
    for (const entry of entries) {
      const serializedKeys: string[] = [];
      for (const key of entry.keys) {
        const serialized = entry.cache.toSerializedKey(key);
        if (serialized !== null) serializedKeys.push(serialized);
      }
      if (serializedKeys.length === 0) continue;

      const group = groups.get(entry.cache.client);
      const serializedEntry = {
        cache: entry.cache,
        serializedKeys,
      };
      if (group) {
        group.push(serializedEntry);
      } else {
        groups.set(entry.cache.client, [serializedEntry]);
      }
    }

    // ⚡ Bolt Optimization:
    // What: Process cache deletes concurrently across clients and use Map.forEach.
    // Why: Avoids sequential network round-trips and Map.entries() iterator overhead.
    // Impact: Reduces total latency for cross-client operations and avoids GC allocations for iterator tuples.
    const promises: Promise<number>[] = [];
    groups.forEach((group, client) => {
      promises.push(ValkeyCacheDeletes.deleteSerializedEntriesFromClient(client, group));
    });

    const results = await Promise.all(promises);
    let deleted = 0;
    for (let i = 0; i < results.length; i++) {
      deleted += results[i];
    }
    return deleted;
  }

  static async invalidate(prefix: string, client = cacheValkeyClient) {
    await deleteKeysWithPrefix(
      client,
      prefix ? `${CACHE_NAMESPACE}:${prefix}:*` : `${CACHE_NAMESPACE}:*`,
    );
    emitValkeyEvent("cache:invalidate", { cacheName: prefix });
  }

  private static async deleteSerializedEntriesFromClient(
    client: ValkeyCacheDeletes["client"],
    entries: SerializedDeleteEntry[],
  ): Promise<number> {
    const cacheKeys: string[] = [];
    const invalidationKeys: string[] = [];
    for (const entry of entries) {
      for (const serializedKey of entry.serializedKeys) {
        cacheKeys.push(entry.cache.getSerializedCacheKey(serializedKey));
        invalidationKeys.push(entry.cache.getSerializedInvalidationKey(serializedKey));
      }
    }

    const result = await client.invokeScript(cacheDeleteWithInvalidationScript, {
      keys: [...cacheKeys, ...invalidationKeys],
      args: [String(cacheKeys.length), String(INVALIDATION_MARKER_TTL_SECONDS)],
    });

    for (const entry of entries) {
      emitValkeyEvent("cache:delete", {
        cacheName: entry.cache.prefix,
        keys: entry.serializedKeys,
      });
    }
    return normalizeCountResult(result);
  }
}
