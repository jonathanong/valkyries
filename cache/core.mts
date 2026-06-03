import type { ValkeyCacheMode, ValkeyCacheOptions } from "../types.mts";
import { cacheValkeyClient } from "../clients.mts";
import { emitValkeyEvent } from "../events.mts";
import { Decoder, type GlideClient, type GlideString } from "@valkey/valkey-glide";
import { normalizeKey } from "../key-normalization.mts";
import { handleValkeyError } from "../errors.mts";
import { normalizeTtlResult } from "../utils.mts";
import { decodeValue, serializeValue } from "../cache-utils.mts";
import type { ValkeyBloomFilter } from "../bloom-filter.mts";
import { CACHE_NAMESPACE, getValuesWithTtlScript, getValueWithTtlScript } from "./constants.mts";

export type CacheEntry = {
  value: string | Buffer | Record<string, unknown> | null;
  ttlSecondsRemaining: number | null;
  bloomMiss: boolean;
};

export abstract class ValkeyCacheCore<K = string> {
  prefix: string;
  ttl: number;
  nullTtl: number;
  mode: ValkeyCacheMode;
  staleTtlAge: number;
  fallbackOnReadError: boolean;
  staleRefresh: boolean;
  protected bloomFilter?: ValkeyBloomFilter;
  protected bloomFilterEnabled?: () => boolean;
  protected refreshPromises: Map<string, Promise<void>>;
  protected keySerializer: (key: K) => string;
  protected client: GlideClient;

  constructor({
    prefix,
    ttlSeconds,
    nullTtlSeconds,
    mode = "json",
    staleTtlAge = 0.9,
    staleRefresh = true,
    bloomFilter,
    bloomFilterEnabled,
    keySerializer,
    client = cacheValkeyClient,
    fallbackOnReadError = true,
  }: ValkeyCacheOptions<K>) {
    if (!prefix) throw new Error("ValkeyCache requires a prefix");
    if (!(ttlSeconds > 0)) throw new Error("ValkeyCache: ttlSeconds must be greater than 0");
    this.prefix = prefix;
    this.ttl = ttlSeconds;
    this.nullTtl = nullTtlSeconds ?? Math.max(1, Math.floor(ttlSeconds / 60));
    this.mode = mode;
    if (Number.isNaN(staleTtlAge) || staleTtlAge < 0 || staleTtlAge > 1) {
      throw new Error("ValkeyCache: staleTtlAge must be between 0 and 1");
    }
    this.staleTtlAge = staleTtlAge;
    this.fallbackOnReadError = fallbackOnReadError;
    this.staleRefresh = staleRefresh;
    this.bloomFilter = bloomFilter;
    this.bloomFilterEnabled = bloomFilterEnabled;
    this.refreshPromises = new Map();
    this.keySerializer =
      (keySerializer as ((key: K) => string) | undefined) ?? ((key: K) => String(key));
    this.client = client;
  }

  /** Reports a Valkey read error and rethrows when fallbackOnReadError is false. */
  protected handleReadError(error: unknown): void {
    if (!this.fallbackOnReadError) throw error;
    handleValkeyError(error);
  }

  protected emitCacheEvents(hitKeys: string[], missKeys: string[], bloomMissKeys: string[]) {
    if (hitKeys.length > 0)
      emitValkeyEvent("cache:hit", {
        cacheName: this.prefix,
        keys: hitKeys,
        count: hitKeys.length,
      });
    if (missKeys.length > 0)
      emitValkeyEvent("cache:miss", {
        cacheName: this.prefix,
        keys: missKeys,
        count: missKeys.length,
      });
    if (bloomMissKeys.length > 0)
      emitValkeyEvent("cache:bloom-miss", {
        cacheName: this.prefix,
        keys: bloomMissKeys,
        count: bloomMissKeys.length,
      });
  }

  protected deduplicateKeys(keys: K[]): {
    validKeys: K[];
    serializedKeys: string[];
    outputIndices: number[];
  } {
    const validKeys: K[] = [];
    const serializedKeys: string[] = [];
    const outputIndices: number[] = [];
    const seen = new Map<string, number>();
    for (let i = 0; i < keys.length; i++) {
      const serialized = this.toSerializedKey(keys[i]);
      if (serialized === null) {
        outputIndices.push(-1);
        continue;
      }
      const existing = seen.get(serialized);
      if (existing !== undefined) {
        outputIndices.push(existing);
      } else {
        const idx = validKeys.length;
        seen.set(serialized, idx);
        validKeys.push(keys[i]);
        serializedKeys.push(serialized);
        outputIndices.push(idx);
      }
    }
    return { validKeys, serializedKeys, outputIndices };
  }

  protected toSerializedKey(key: K): string | null {
    if (key == null) return null;
    const serialized = normalizeKey(this.keySerializer(key));
    return serialized === "" ? null : serialized;
  }

  protected getSerializedCacheKey(serializedKey: string): string {
    return `${CACHE_NAMESPACE}:${this.prefix}:{${serializedKey}}`;
  }

  protected getSerializedInvalidationKey(serializedKey: string): string {
    return `${CACHE_NAMESPACE}:${this.prefix}:invalidation:{${serializedKey}}`;
  }

  protected async getValueWithTtl(serializedKey: string): Promise<CacheEntry> {
    const cacheKey = this.getSerializedCacheKey(serializedKey);
    const bloomEnabled = this.bloomFilterEnabled?.() ?? true;
    const bloomFilterKey = bloomEnabled ? (this.bloomFilter?.getKey() ?? "") : "";
    const scriptResult = await this.client.invokeScript(getValueWithTtlScript, {
      keys: [cacheKey],
      args: [bloomFilterKey],
      decoder: Decoder.Bytes,
    });
    const valueRaw = Array.isArray(scriptResult) ? (scriptResult[0] as GlideString | null) : null;
    const ttlSecondsRemaining = Array.isArray(scriptResult)
      ? normalizeTtlResult(scriptResult[1])
      : null;
    const bloomMiss = Number(Array.isArray(scriptResult) ? (scriptResult[2] ?? 0) : 0);
    if (bloomMiss === 1) return { value: null, ttlSecondsRemaining: null, bloomMiss: true };
    const value = await this.decode(serializedKey, valueRaw);
    return { value, ttlSecondsRemaining: ttlSecondsRemaining ?? null, bloomMiss: false };
  }

  protected async getValuesWithTtl(serializedKeys: string[]): Promise<CacheEntry[]> {
    if (serializedKeys.length === 0) return [];
    const cacheKeys = serializedKeys.map((k) => this.getSerializedCacheKey(k));
    const bloomEnabled = this.bloomFilterEnabled?.() ?? true;
    const bloomFilterKey = bloomEnabled ? (this.bloomFilter?.getKey() ?? "") : "";
    const scriptResult = await this.client.invokeScript(getValuesWithTtlScript, {
      keys: cacheKeys,
      args: [bloomFilterKey],
      decoder: Decoder.Bytes,
    });
    const rawResults = Array.isArray(scriptResult) ? scriptResult : [];
    return Promise.all(
      serializedKeys.map((key, index) => this.decodeCacheEntry(key, rawResults, index)),
    );
  }

  protected shouldRefreshTtl(ttlSecondsRemaining: number | null) {
    if (!this.staleRefresh) return false;
    if (typeof ttlSecondsRemaining !== "number") return false;
    if (ttlSecondsRemaining < 0) return false;
    const refreshWindow = (1 - this.staleTtlAge) * this.ttl;
    return refreshWindow > 0 && ttlSecondsRemaining < refreshWindow;
  }

  protected async decode(
    serializedKey: string,
    result: GlideString | null,
  ): Promise<string | Buffer | Record<string, unknown> | null> {
    try {
      return await decodeValue(result, this.mode);
    } catch (cause) {
      if (process.env.NODE_ENV === "test") throw cause;
      const isJsonError = cause instanceof SyntaxError;
      const err = new Error(
        isJsonError
          ? "ValkeyCache: failed to parse JSON value"
          : "ValkeyCache: failed to gunzip value",
        { cause },
      );
      handleValkeyError(err);
      this.deleteBySerializedKey(serializedKey).catch(handleValkeyError);
      return null;
    }
  }

  protected async serializeValue(value: unknown): Promise<string | Buffer> {
    return await serializeValue(value, this.mode);
  }
  protected abstract deleteBySerializedKey(...serializedKeys: string[]): Promise<number>;
  private async decodeCacheEntry(
    key: string,
    rawResults: unknown[],
    index: number,
  ): Promise<CacheEntry> {
    const offset = index * 3;
    const bloomMiss = Number(rawResults[offset + 2] ?? 0) === 1;
    if (bloomMiss) return { value: null, ttlSecondsRemaining: null, bloomMiss: true };
    const rawValue = rawResults[offset] as GlideString | null;
    const value = await this.decode(key, rawValue);
    return {
      value,
      ttlSecondsRemaining: normalizeTtlResult(rawResults[offset + 1]),
      bloomMiss: false,
    };
  }
}
