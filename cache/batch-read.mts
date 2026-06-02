import { durationInMilliseconds } from '../cache-utils.mts'
import { trackCacheCall } from '../cache-metrics.mts'
import { handleValkeyError } from '../errors.mts'
import { ValkeyCacheSingleRead } from './single-read.mts'

class BatchReadStats {
  hits = 0
  misses = 0
  bloomMisses = 0
  hitKeys: string[] = []
  missKeys: string[] = []
  bloomMissKeys: string[] = []
}

export abstract class ValkeyCacheBatchRead<K = string> extends ValkeyCacheSingleRead<K> {
  cacheGetByAnyBatch<T>(
    batchFn: (keys: K[]) => Promise<Array<T | null | undefined>>,
  ): (keys: K[]) => Promise<Array<T | null>> {
    return async (keys: K[]): Promise<Array<T | null>> => {
      const {
        validKeys: normalizedKeys,
        serializedKeys,
        outputIndices,
      } = this.deduplicateKeys(keys)
      if (normalizedKeys.length === 0) {
        this.trackEmptyBatchRead()
        return Array(keys.length).fill(null)
      }
      const scatter = (normalized: Array<T | null>): Array<T | null> =>
        outputIndices.map(idx => (idx === -1 ? null : normalized[idx]))
      const stats = new BatchReadStats()
      const start = process.hrtime.bigint()
      try {
        let cachedEntries: Awaited<ReturnType<typeof this.getValuesWithTtl>>
        try {
          cachedEntries = await this.getValuesWithTtl(serializedKeys)
        } catch (error) {
          if (!this.fallbackOnReadError) throw error
          handleValkeyError(error)
          stats.misses = normalizedKeys.length
          stats.missKeys = serializedKeys
          const fallbackResults = await batchFn(normalizedKeys)
          assertBatchResultLength(fallbackResults, normalizedKeys.length)
          return scatter(Array.from(fallbackResults, v => v ?? null))
        }
        const cachedValues = cachedEntries.map(entry => entry.value as T | null)
        const missing = collectMissingKeys(
          cachedEntries,
          normalizedKeys,
          serializedKeys,
          cachedValues,
          stats,
        )
        stats.misses = missing.keys.length
        stats.hits = normalizedKeys.length - stats.misses - stats.bloomMisses
        this.refreshStaleBatchEntries(serializedKeys, normalizedKeys, cachedEntries, batchFn)
        if (missing.keys.length === 0) return scatter(cachedValues)
        const fetchedResults = await batchFn(missing.keys)
        assertBatchResultLength(fetchedResults, missing.keys.length)
        const results = mergeFetchedResults(cachedValues, missing.indices, fetchedResults)
        const setEntries = missing.keys.map((key, i) => {
          const value = fetchedResults[i] ?? null
          return { key, value, ttl: value === null ? this.nullTtl : undefined }
        })
        this.setBatchIfNotInvalidated(setEntries).catch(handleValkeyError)
        return scatter(results)
      } finally {
        this.trackBatchRead(start, stats)
      }
    }
  }

  async getBatch(keys: K[]): Promise<Array<string | Buffer | Record<string, unknown> | null>> {
    const { serializedKeys, outputIndices } = this.deduplicateKeys(keys)
    if (serializedKeys.length === 0) {
      this.trackEmptyBatchRead()
      return Array(keys.length).fill(null)
    }
    const stats = new BatchReadStats()
    const start = process.hrtime.bigint()
    try {
      const entries = await this.getValuesWithTtl(serializedKeys)
      const values = entries.map((entry, i) => {
        if (entry.bloomMiss) {
          stats.bloomMisses++
          stats.bloomMissKeys.push(serializedKeys[i])
          return null
        }
        const keyExists = entry.ttlSecondsRemaining !== null && entry.ttlSecondsRemaining !== -2
        if (entry.value !== null || keyExists) {
          stats.hits++
          stats.hitKeys.push(serializedKeys[i])
        } else {
          stats.misses++
          stats.missKeys.push(serializedKeys[i])
        }
        return entry.value
      })
      return outputIndices.map(idx => (idx === -1 ? null : values[idx]))
    } finally {
      this.trackBatchRead(start, stats)
    }
  }

  private trackEmptyBatchRead() {
    trackCacheCall({
      cacheName: this.prefix,
      batch: true,
      hits: 0,
      misses: 0,
      bloomMisses: 0,
      duration: 0,
    })
  }

  private trackBatchRead(start: bigint, stats: BatchReadStats) {
    trackCacheCall({
      cacheName: this.prefix,
      batch: true,
      hits: stats.hits,
      misses: stats.misses,
      bloomMisses: stats.bloomMisses,
      duration: durationInMilliseconds(start),
    })
    this.emitCacheEvents(stats.hitKeys, stats.missKeys, stats.bloomMissKeys)
  }
}

function collectMissingKeys<K, T>(
  entries: Array<{ value: unknown; ttlSecondsRemaining: number | null; bloomMiss: boolean }>,
  normalizedKeys: K[],
  serializedKeys: string[],
  cachedValues: Array<T | null>,
  stats: BatchReadStats,
) {
  const indices: number[] = []
  const keys: K[] = []
  // ⚡ Bolt Optimization:
  // What: Combine the TTL check and avoid a temporary boolean variable.
  // Why: Simplifies the condition path in the hot loop.
  // Impact: Better throughput for large batches.
  for (let i = 0; i < cachedValues.length; i++) {
    const entry = entries[i]
    if (entry.bloomMiss) {
      stats.bloomMisses++
      stats.bloomMissKeys.push(serializedKeys[i])
      continue
    }
    if (
      entry.value === null &&
      (entry.ttlSecondsRemaining === null || entry.ttlSecondsRemaining === -2)
    ) {
      indices.push(i)
      keys.push(normalizedKeys[i])
      stats.missKeys.push(serializedKeys[i])
    } else {
      stats.hitKeys.push(serializedKeys[i])
    }
  }
  return { indices, keys }
}

function assertBatchResultLength(results: unknown, expectedLength: number) {
  if (!Array.isArray(results) || results.length !== expectedLength) {
    throw new Error(
      `Batch function returned invalid result: expected array of ${expectedLength} items, got ${Array.isArray(results) ? results.length : typeof results}`,
    )
  }
}

function mergeFetchedResults<T>(
  cachedValues: Array<T | null>,
  missingIndices: number[],
  fetchedResults: Array<T | null | undefined>,
): Array<T | null> {
  // ⚡ Bolt Optimization:
  // What: Mutate the intermediate `cachedValues` array directly instead of spreading.
  // Why: Avoids O(n) array clone allocation in the hot path.
  // Impact: Lower allocation pressure during merge.
  for (let i = 0; i < missingIndices.length; i++) {
    cachedValues[missingIndices[i]] = fetchedResults[i] ?? null
  }
  return cachedValues
}
