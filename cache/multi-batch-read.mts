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
  TConfigs extends ReadonlyArray<{ cache: ValkeyCache<any>; keys: any[] }>,
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
  configs: ReadonlyArray<{ cache: ValkeyCache<any>; keys: any[] }>,
): Promise<Array<Array<CacheValue>>> {
  return Promise.all(configs.map((cfg) => cfg.cache.getBatch(cfg.keys)));
}

async function singleRoundTripPath(
  configs: ReadonlyArray<{ cache: ValkeyCache<any>; keys: any[] }>,
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
    // eslint-disable-next-line unicorn/no-new-array
    return configs.map((cfg) => new Array<CacheValue>(cfg.keys.length).fill(null));
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
    const dedupedValuePromises: Array<Promise<CacheValue>> = [];
    for (let j = 0; j < physicalKeys.length; j++) {
      const raw = rawValues[offset + j] ?? null;
      dedupedValuePromises.push(configs[i].cache.decodeRawValue(serializedKeys[j], raw));
    }
    const dedupedValues = await Promise.all(dedupedValuePromises);

    // Scatter back to original positions using outputIndices
    const scattered: Array<CacheValue> = [];
    scattered.length = outputIndices.length;
    for (let j = 0; j < outputIndices.length; j++) {
      const idx = outputIndices[j];
      scattered[j] = idx === -1 ? null : dedupedValues[idx];
    }
    results.push(scattered);
  }

  return results;
}
