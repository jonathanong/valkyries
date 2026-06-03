import type { ValkeyBloomFilterOptions } from "./types.mts";
import assert from "node:assert";
import { cacheValkeyClient } from "./clients.mts";
import type { GlideClient } from "@valkey/valkey-glide";
import {
  deleteBloomFilter,
  deleteWithAdditionalKeys,
  ensureExists,
  isReady,
  keyExists,
  rebuild,
  rebuildFromStream,
} from "./bloom-filter/rebuilds.mts";
import { exists, existsIfReady, mexists, mexistsIfReady } from "./bloom-filter/lookups.mts";
import { add, addOrThrow, addStream } from "./bloom-filter/writes.mts";
import type { BloomFilterState } from "./bloom-filter/types.mts";
export { LUA_UNPACK_BATCH_SIZE } from "./bloom-filter/scripts.mts";
export { isBloomMissingKeyError, normalizeBloomCheckResult } from "./bloom-filter/results.mts";

export class ValkeyBloomFilter {
  private name: string;
  private capacity: number;
  private errorRate: number;
  private expansionRate: number;
  private batchSize: number;
  private readonly concurrencyLimit: number;
  private liveKey: string;
  private buildingKey: string;
  private client: GlideClient;

  constructor(options: ValkeyBloomFilterOptions) {
    const {
      name,
      capacity,
      errorRate,
      expansionRate = 2,
      batchSize = 10_000,
      concurrencyLimit = 16,
      client = cacheValkeyClient,
    } = options;

    assert(name && typeof name === "string", "name must be a non-empty string");
    assert(capacity > 0, "capacity must be positive");
    assert(errorRate > 0 && errorRate < 1, "errorRate must be between 0 and 1");
    assert(expansionRate > 0, "expansionRate must be positive");
    assert(batchSize > 0, "batchSize must be positive");
    assert(concurrencyLimit > 0, "concurrencyLimit must be positive");

    this.name = name;
    this.capacity = capacity;
    this.errorRate = errorRate;
    this.expansionRate = expansionRate;
    this.batchSize = batchSize;
    this.concurrencyLimit = concurrencyLimit;
    this.liveKey = `bloom-filter:${name}`;
    this.buildingKey = `bloom-filter:${name}:building`;
    this.client = client;
  }

  /**
   * BF.EXISTS — check if a single item may be in the filter.
   * Returns null if filter doesn't exist (caller should fall back to DB).
   * Single roundtrip via Lua script (EXISTS + BF.EXISTS combined).
   */
  exists(item: string): Promise<boolean | null> {
    return exists(this.state(), item);
  }

  /**
   * BF.MEXISTS — check multiple items in the filter.
   * Returns null per-item if filter doesn't exist (caller should fall back to DB).
   * Single roundtrip via Lua script (EXISTS + BF.MEXISTS combined).
   */
  mexists(items: string[]): Promise<(boolean | null)[]> {
    return mexists(this.state(), items);
  }

  /**
   * BF.EXISTS guarded by a deterministic readiness key.
   * Returns null when the ready marker or filter is absent, so callers fall back
   * to their authoritative store instead of trusting an empty/partial filter.
   */
  existsIfReady(readyKey: string, item: string): Promise<boolean | null> {
    return existsIfReady(this.state(), readyKey, item);
  }

  /**
   * BF.MEXISTS guarded by a deterministic readiness key.
   * Returns null per item when the ready marker or filter is absent.
   */
  mexistsIfReady(readyKey: string, items: string[]): Promise<(boolean | null)[]> {
    return mexistsIfReady(this.state(), readyKey, items);
  }

  /**
   * Add items to bloom filter using BF.MADD. Returns a Promise that resolves when all
   * batches are written (errors are logged via onError, not thrown).
   * Items are chunked at batchSize to avoid hitting Valkey argument-count limits.
   * Each chunk is a single Lua round-trip that also writes to buildingKey if an
   * active rebuild is in progress, so entries are not silently dropped when
   * rebuildFromStream renames buildingKey → liveKey.
   *
   * If neither the live key nor the building key exists (e.g. during the window
   * between worker startup and backfill completion), add() is a no-op. This prevents
   * BF.MADD from auto-creating an under-provisioned filter that would cause false
   * negatives in cache reads. See backfill-bloom-filter.mts for the warmup design.
   */
  add(items: string[]): Promise<void> {
    return add(this.state(), items);
  }

  /**
   * Add items to bloom filter — same as add(), but throws on error instead of absorbing via onError.
   * Use when the caller needs to detect failures and take corrective action (e.g. clearing readiness).
   */
  async addOrThrow(items: string[]): Promise<void> {
    await addOrThrow(this.state(), items);
  }

  /**
   * Awaitable add — streams batches from an AsyncIterable and BF.MADDs each batch.
   * Use for large-dataset population to avoid loading everything into memory.
   * Unlike add(), errors are propagated (not absorbed via onError).
   */
  async addStream(batches: AsyncIterable<string[]>): Promise<void> {
    await addStream(this.state(), batches);
  }

  /**
   * Rebuild the filter from a complete item list. Uses building key and atomic rename.
   * Only deletes the building key at start (not the live key).
   */
  async rebuild(items: string[]): Promise<void> {
    await rebuild(this.state(), items);
  }

  /**
   * Rebuild the filter from an async iterable of item batches. Uses building key and atomic rename.
   * Only deletes the building key at start (not the live key).
   * @param capacityOverride - Optional capacity for this rebuild, such as 2x the current row count.
   */
  async rebuildFromStream(
    batches: AsyncIterable<string[]>,
    capacityOverride?: number,
  ): Promise<void> {
    await rebuildFromStream(this.state(), batches, capacityOverride);
  }

  async delete(): Promise<void> {
    await deleteBloomFilter(this.state());
  }

  async deleteWithAdditionalKeys(additionalKeys: string[]): Promise<void> {
    await deleteWithAdditionalKeys(this.state(), additionalKeys);
  }

  keyExists(): Promise<boolean> {
    return keyExists(this.state());
  }

  isReady(readyKey: string): Promise<boolean> {
    return isReady(this.state(), readyKey);
  }

  getKey(): string {
    return this.liveKey;
  }

  getBuildingKey(): string {
    return this.buildingKey;
  }

  getConfig() {
    return {
      name: this.name,
      capacity: this.capacity,
      errorRate: this.errorRate,
      batchSize: this.batchSize,
      concurrencyLimit: this.concurrencyLimit,
      liveKey: this.liveKey,
      buildingKey: this.buildingKey,
    };
  }

  async ensureExists(capacity?: number): Promise<void> {
    await ensureExists(this.state(), capacity);
  }

  private state(): BloomFilterState {
    return {
      name: this.name,
      capacity: this.capacity,
      errorRate: this.errorRate,
      expansionRate: this.expansionRate,
      batchSize: this.batchSize,
      concurrencyLimit: this.concurrencyLimit,
      liveKey: this.liveKey,
      buildingKey: this.buildingKey,
      client: this.client,
    };
  }
}
