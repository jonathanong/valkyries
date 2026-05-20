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

export class ValkeyCacheDeletes<K = string> extends ValkeyCacheMutations<K> {
  async delete(...keys: K[]): Promise<number> {
    const serializedKeys: string[] = [];
    const keyArray: string[] = [];

    // ⚡ Bolt Optimization:
    // What: Replace array.flatMap with a single for-loop
    // Why: flatMap creates intermediate arrays and has higher V8 overhead.
    // Impact: Reduces GC pressure and improves throughput for batch operations.
    for (let i = 0; i < keys.length; i++) {
      const serialized = this.toSerializedKey(keys[i]);
      if (serialized !== null) {
        serializedKeys.push(serialized);
        keyArray.push(this.getSerializedCacheKey(serialized));
      }
    }

    if (keyArray.length === 0) return 0;
    const invalidationKeys = serializedKeys.map((key) => this.getSerializedInvalidationKey(key));
    const result = await this.client.invokeScript(cacheDeleteWithInvalidationScript, {
      keys: [...keyArray, ...invalidationKeys],
      args: [String(keyArray.length), String(INVALIDATION_MARKER_TTL_SECONDS)],
    });
    const count = normalizeCountResult(result);
    emitValkeyEvent("cache:delete", { cacheName: this.prefix, keys: serializedKeys });
    return count;
  }

  protected async deleteBySerializedKey(...serializedKeys: string[]): Promise<number> {
    const keyArray = serializedKeys.map((key) => this.getSerializedCacheKey(key));
    if (keyArray.length === 0) return 0;
    const count = await this.client.unlink(keyArray);
    emitValkeyEvent("cache:delete", { cacheName: this.prefix, keys: serializedKeys });
    return count;
  }

  invalidate() {
    return ValkeyCacheDeletes.invalidate(this.prefix, this.client);
  }

  static async invalidate(prefix: string, client = cacheValkeyClient) {
    await deleteKeysWithPrefix(
      client,
      prefix ? `${CACHE_NAMESPACE}:${prefix}:*` : `${CACHE_NAMESPACE}:*`,
    );
    emitValkeyEvent("cache:invalidate", { cacheName: prefix });
  }
}
