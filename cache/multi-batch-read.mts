import { Decoder } from "@valkey/valkey-glide";
import type { ValkeyCache } from "../cache.mts";

type CacheValue = string | Buffer | Record<string, unknown> | null;
type BatchConfig = { cache: ValkeyCache<any>; keys: any[] };
type BatchResult<TConfigs extends ReadonlyArray<BatchConfig>> = {
  [I in keyof TConfigs]: Array<CacheValue>;
};
type PhysicalCacheKeys = ReturnType<ValkeyCache<any>["getPhysicalCacheKeys"]>;

/**
 * Reads keys from multiple ValkeyCache instances in a single operation.
 *
 * @param configs - Array of { cache, keys } pairs to read from.
 * @param options.clusterSafe - When false (default), issues a single MGET across all
 *   caches for one round trip. **Only safe when all caches share a standalone (non-cluster)
 *   Valkey client.** When true, issues one MGET per cache in parallel — safe for all
 *   topologies including Redis Cluster.
 *
 * Returns a tuple-typed array where each element is the result array for the
 * corresponding config entry.
 */
export async function multiCacheGetByAnyBatch<TConfigs extends ReadonlyArray<BatchConfig>>(
  configs: TConfigs,
  options?: { clusterSafe?: boolean },
): Promise<BatchResult<TConfigs>> {
  const clusterSafe = options?.clusterSafe ?? false;

  if (clusterSafe) {
    return clusterSafePath(configs);
  }
  return singleRoundTripPath(configs);
}

async function clusterSafePath<TConfigs extends ReadonlyArray<BatchConfig>>(
  configs: TConfigs,
): Promise<BatchResult<TConfigs>> {
  // ⚡ Bolt Optimization: Use pre-allocated arrays and indexed loops instead of
  // iterator-based map operations to reduce allocation and hot-path closure overhead.
  if (configs.length === 0) {
    return [] as BatchResult<TConfigs>;
  }
  const configsLen = configs.length;
  // eslint-disable-next-line unicorn/no-new-array
  const promises = new Array<Promise<Array<CacheValue>>>(configsLen);
  for (let i = 0; i < configsLen; i++) {
    const cfg = configs[i];
    promises[i] = cfg.cache.getBatch(cfg.keys);
  }
  return Promise.all(promises) as Promise<BatchResult<TConfigs>>;
}

async function singleRoundTripPath<TConfigs extends ReadonlyArray<BatchConfig>>(
  configs: TConfigs,
): Promise<BatchResult<TConfigs>> {
  // ⚡ Bolt Optimization: Keep loops pre-allocated and decode values in batch
  // to reduce allocation and asynchronous overhead.
  const configsLen = configs.length;
  // eslint-disable-next-line unicorn/no-new-array
  const perConfig = new Array<PhysicalCacheKeys>(configsLen);
  for (let i = 0; i < configsLen; i++) {
    const cfg = configs[i];
    perConfig[i] = cfg.cache.getPhysicalCacheKeys(cfg.keys);
  }

  // Build a flat list of all physical keys across all caches
  const allPhysicalKeys: string[] = [];
  // eslint-disable-next-line unicorn/no-new-array
  const offsets = new Array<number>(configsLen);
  for (let i = 0; i < configsLen; i++) {
    const { physicalKeys } = perConfig[i];
    offsets[i] = allPhysicalKeys.length;
    for (let j = 0; j < physicalKeys.length; j++) {
      allPhysicalKeys.push(physicalKeys[j]);
    }
  }

  const allPhysicalKeysLen = allPhysicalKeys.length;
  if (allPhysicalKeysLen === 0) {
    // eslint-disable-next-line unicorn/no-new-array
    const emptyResults = new Array<Array<CacheValue>>(configsLen);
    for (let i = 0; i < configsLen; i++) {
      emptyResults[i] = Array<CacheValue>(configs[i].keys.length).fill(null);
    }
    return emptyResults as BatchResult<TConfigs>;
  }

  const client = configs[0].cache.getClient();
  const rawValues = await client.mget(allPhysicalKeys, { decoder: Decoder.Bytes });

  // Decode all responses together to avoid per-config sequential await chains.
  // eslint-disable-next-line unicorn/no-new-array
  const decodePromises = new Array<Promise<CacheValue>>(allPhysicalKeysLen);
  // eslint-disable-next-line unicorn/no-new-array
  for (let i = 0; i < configsLen; i++) {
    const { physicalKeys, serializedKeys } = perConfig[i];
    const offset = offsets[i];

    for (let j = 0; j < physicalKeys.length; j++) {
      const raw = rawValues[offset + j] ?? null;
      decodePromises[offset + j] = configs[i].cache.decodeRawValue(serializedKeys[j], raw);
    }
  }

  const decodedValues = await Promise.all(decodePromises);
  // Distribute values back to each cache
  // eslint-disable-next-line unicorn/no-new-array
  const results = new Array<Array<CacheValue>>(configsLen);
  for (let i = 0; i < configsLen; i++) {
    const { physicalKeys, outputIndices } = perConfig[i];
    const offset = offsets[i];
    const dedupedValues = decodedValues.slice(offset, offset + physicalKeys.length);

    // Scatter back to original positions using outputIndices
    // eslint-disable-next-line unicorn/no-new-array
    const scattered = new Array<CacheValue>(outputIndices.length);
    for (let j = 0; j < outputIndices.length; j++) {
      const idx = outputIndices[j];
      scattered[j] = idx === -1 ? null : dedupedValues[idx];
    }
    results[i] = scattered;
  }

  return results as BatchResult<TConfigs>;
}
