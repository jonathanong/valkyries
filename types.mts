import type { GlideClient } from "@valkey/valkey-glide";

export type ValkeyClientsOption = {
  cacheClient?: GlideClient;
  rateLimiterClient?: GlideClient;
  dynamicConfigClient?: GlideClient;
};

export type RateLimiterOptions = {
  /** The prefix to use for the rate limiter */
  prefix: string;
  /** The TTL in seconds for the rate limiter */
  ttlSeconds: number;
  /** Optional Valkey client. Defaults to the package rate limiter client. */
  client?: GlideClient;
};

export type ValkeyCacheOptions<K = string> = {
  /** The prefix to use for the cache */
  prefix: string;
  /** The TTL in seconds for non-null values */
  ttlSeconds: number;
  /** The TTL in seconds for null values, defaults to ttlSeconds / 60 */
  nullTtlSeconds?: number;
  /** The mode to use: 'json' (default) for JSON serialization, 'text' for raw text storage, 'buffer' for Buffer storage */
  mode?: "json" | "text" | "buffer";
  /** Fraction of ttlSeconds representing the age threshold; values are stale when ttlSecondsRemaining < (1 - staleTtlAge) * ttlSeconds (0-1, defaults to 0.9) */
  staleTtlAge?: number;
  /** Optional bloom filter for negative lookups — skip DB calls for entities that definitely don't exist */
  bloomFilter?: import("./bloom-filter.mts").ValkeyBloomFilter;
  /** Optional runtime feature flag — if provided, called per-request; bloom filter is bypassed when it returns false */
  bloomFilterEnabled?: () => boolean;
  /** Optional Valkey client. Defaults to the package cache client. */
  client?: GlideClient;
} & (K extends string
  ? {
      /**
       * Converts a key to its string representation for cache storage.
       * The returned string is automatically lowercased and trimmed before use.
       * Defaults to `String(key)` for string keys.
       */
      keySerializer?: (key: K) => string;
    }
  : {
      /**
       * Converts a key to its string representation for cache storage.
       * The returned string is automatically lowercased and trimmed before use.
       */
      keySerializer: (key: K) => string;
    });

export type ValkeyCacheMode = "json" | "text" | "buffer";
export type ValkeyCacheResponse = Promise<string | Buffer | Record<string, unknown> | null>;

export type DynamicConfigField = string | number | boolean;
export type DynamicConfigFieldType = "string" | "number" | "boolean";
export type DynamicConfigOptions = {
  /** The TTL in seconds until the values become stale and values are re-fetched */
  staleTtlSeconds?: number | null;
  /** The key of the hash to use for the distributed configuration */
  key: string;
  /** The fields and types of the hash to use for the distributed configuration */
  fieldTypes: Record<string, DynamicConfigFieldType>;
  /** The default field values if not set */
  defaultFields: Record<string, DynamicConfigField>;
  /** Optional Valkey client. Defaults to the package dynamic config client. */
  client?: GlideClient;
};

export type ValkeyBloomFilterOptions = {
  /** The name of the bloom filter (used for key prefixing) */
  name: string;
  /** The expected capacity (number of items) */
  capacity: number;
  /** The target error rate (0-1, e.g., 0.01 for 1%) */
  errorRate: number;
  /** The batch size for bulk operations (optional, defaults to 10,000; Lua paths clamp to 5,000) */
  batchSize?: number;
  /** The expansion rate for auto-growth (optional, defaults to 2) */
  expansionRate?: number;
  /** Optional Valkey client. Defaults to the package cache client. */
  client?: GlideClient;
};
