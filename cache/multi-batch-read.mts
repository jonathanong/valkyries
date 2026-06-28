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
    return clusterSafePath(configs);
  }
  return singleRoundTripPath(configs);
}

async function clusterSafePath<TConfigs extends Array<{ cache: ValkeyCache<any>; keys: any[] }>>(
  configs: TConfigs,
): Promise<{ [I in keyof TConfigs]: Array<CacheValue> }> {
  return Promise.all(configs.map((cfg) => cfg.cache.getBatch(cfg.keys))) as unknown as Promise<{
    [I in keyof TConfigs]: Array<CacheValue>;
  }>;
}

async function singleRoundTripPath<
  TConfigs extends Array<{ cache: ValkeyCache<any>; keys: any[] }>,
>(configs: TConfigs): Promise<{ [I in keyof TConfigs]: Array<CacheValue> }> {
  // Collect per-config metadata: physicalKeys, outputIndices, serializedKeys
  // ⚡ Bolt Optimization:
  // What: Pre-allocate array and use an indexed loop instead of .map().
  // Why: Avoids iterator overhead and array resizing.
  // Impact: Improves memory allocation performance for batch configurations.
  const configsLen = configs.length;
  // eslint-disable-next-line unicorn/no-new-array
  const perConfig = new Array<{
    physicalKeys: string[];
    outputIndices: number[];
    serializedKeys: string[];
  }>(configsLen);
  for (let i = 0; i < configsLen; i++) {
    perConfig[i] = configs[i].cache.getPhysicalCacheKeys(configs[i].keys);
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
    return emptyResults as unknown as { [I in keyof TConfigs]: Array<CacheValue> };
  }

  // Use the first cache's client — all caches must share the same standalone client
  // for this path to be safe. In cluster mode keys land on different slots, so MGET
  // will fail unless all keys hash to the same slot, which they do not here.
  const client = configs[0].cache.getClient();
  const rawValues = await client.mget(allPhysicalKeys, { decoder: Decoder.Bytes });

  // ⚡ Bolt Optimization:
  // What: Pre-allocate an array of decode promises instead of nested sequential awaits.
  // Why: MGET retrieves values simultaneously, but previously we sequentially decoded them in a loop.
  //      By executing all Promise-based decoding operations concurrently with Promise.all,
  //      we reduce time blocked on single-item async decoding steps (e.g. gzip decompression).
  // Impact: Measurably reduces overall latency of large multi-batch read operations.
  // eslint-disable-next-line unicorn/no-new-array
  const decodePromises = new Array<Promise<CacheValue>>(allPhysicalKeysLen);
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
    const { outputIndices } = perConfig[i];
    const offset = offsets[i];

    // Scatter back to original positions using outputIndices
    // eslint-disable-next-line unicorn/no-new-array
    const scattered = new Array<CacheValue>(outputIndices.length);
    for (let j = 0; j < outputIndices.length; j++) {
      const idx = outputIndices[j];
      scattered[j] = idx === -1 ? null : decodedValues[offset + idx];
    }
    results[i] = scattered;
  }

  return results as unknown as { [I in keyof TConfigs]: Array<CacheValue> };
}
