import { Decoder } from "@valkey/valkey-glide";
import type { ValkeyCache } from "../cache.mts";

type CacheValue = string | Buffer | Record<string, unknown> | null;

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
export async function multiCacheGetByAnyBatch<
  TConfigs extends Array<{ cache: ValkeyCache<any>; keys: any[] }>,
>(
  configs: TConfigs,
  options?: { clusterSafe?: boolean },
): Promise<{ [I in keyof TConfigs]: Array<CacheValue> }> {
  const clusterSafe = options?.clusterSafe ?? false;

  if (clusterSafe) {
    return clusterSafePath(configs) as Promise<{ [I in keyof TConfigs]: Array<CacheValue> }>;
  }
  return singleRoundTripPath(configs) as Promise<{ [I in keyof TConfigs]: Array<CacheValue> }>;
}

async function clusterSafePath(
  configs: Array<{ cache: ValkeyCache<any>; keys: any[] }>,
): Promise<Array<Array<CacheValue>>> {
  // eslint-disable-next-line unicorn/no-new-array
  const promises = new Array<Promise<Array<CacheValue>>>(configs.length);
  for (let i = 0; i < configs.length; i++) {
    promises[i] = configs[i].cache.getBatch(configs[i].keys);
  }
  return Promise.all(promises);
}

async function singleRoundTripPath(
  configs: Array<{ cache: ValkeyCache<any>; keys: any[] }>,
): Promise<Array<Array<CacheValue>>> {
  // Collect per-config metadata: physicalKeys, outputIndices, serializedKeys
  const perConfig = configs.map((cfg) => cfg.cache.getPhysicalCacheKeys(cfg.keys));

  // Build a flat list of all physical keys across all caches
  const allPhysicalKeys: string[] = [];
  const offsets: number[] = [];
  for (const { physicalKeys } of perConfig) {
    offsets.push(allPhysicalKeys.length);
    for (const k of physicalKeys) allPhysicalKeys.push(k);
  }

  if (allPhysicalKeys.length === 0) {
    return configs.map((cfg) => Array<CacheValue>(cfg.keys.length).fill(null));
  }

  // Use the first cache's client — all caches must share the same standalone client
  // for this path to be safe. In cluster mode keys land on different slots, so MGET
  // will fail unless all keys hash to the same slot, which they do not here.
  const client = configs[0].cache.getClient();
  const rawValues = await client.mget(allPhysicalKeys, { decoder: Decoder.Bytes });

  // Distribute raw values back to each cache for decoding
  const results: Array<Array<CacheValue>> = [];
  for (let i = 0; i < configs.length; i++) {
    const { physicalKeys, outputIndices, serializedKeys } = perConfig[i];
    const offset = offsets[i];

    // Decode deduped results
    // eslint-disable-next-line unicorn/no-new-array
    const dedupedValues = new Array<CacheValue>(physicalKeys.length);
    for (let j = 0; j < physicalKeys.length; j++) {
      const raw = rawValues[offset + j] ?? null;
      dedupedValues[j] = await configs[i].cache.decodeRawValue(serializedKeys[j], raw);
    }

    // Scatter back to original positions using outputIndices
    // eslint-disable-next-line unicorn/no-new-array
    const scattered = new Array<CacheValue>(outputIndices.length);
    for (let j = 0; j < outputIndices.length; j++) {
      const idx = outputIndices[j];
      scattered[j] = idx === -1 ? null : dedupedValues[idx];
    }
    results.push(scattered);
  }

  return results;
}
