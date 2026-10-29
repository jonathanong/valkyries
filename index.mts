// Bun's bundler does not await a top-level-await module (clients.mts and everything that imports
// it) reached only through `export * from`, so a dynamically imported compiled bundle would see
// undefined clients. A side-effect import of the same module takes the awaited path.
import "./events.mts";
import "./rate-limiter.mts";
import "./cache.mts";
import "./bloom-filter.mts";
import "./dynamic-config.mts";
import "./idempotency-key.mts";
import "./conditional.mts";
import "./lease.mts";
import "./clients.mts";
import "./shutdown.mts";
import "./scripts.mts";
import "./utils.mts";
import "./errors.mts";
import "./key-normalization.mts";
import "./cache-metrics.mts";
import "./retry.mts";

export * from "./events.mts";
export * from "./rate-limiter.mts";
export * from "./cache.mts";
export * from "./bloom-filter.mts";
export * from "./dynamic-config.mts";
export * from "./idempotency-key.mts";
export * from "./conditional.mts";
export * from "./lease.mts";
export * from "./clients.mts";
export * from "./shutdown.mts";
export * from "./scripts.mts";
export * from "./utils.mts";
export * from "./errors.mts";
export * from "./key-normalization.mts";
export * from "./cache-metrics.mts";
export * from "./retry.mts";
export { scanAndUnlinkKeyPrefixes, scanAndUnlinkKeys } from "./delete.mts";
export { expireKeysWithNoExpiry } from "./expiry.mts";
export {
  countKeysByPrefix,
  getValkeyMemoryInfo,
  parseValkeyMemoryInfo,
  validateKeyPrefixRegistry,
} from "./diagnostics.mts";
export type {
  CountKeysByPrefixOptions,
  DiagnosticsOptions,
  ValkeyMemorySummary,
} from "./diagnostics.mts";
export type {
  RateLimiterAddAndCheckWindowsOptions,
  RateLimiterConsumeOptions,
  RateLimiterConsumeResult,
  RateLimiterOptions,
  RateLimiterWindow,
  ValkeyBloomFilterOptions,
  ValkeyCacheOptions,
  ValkeyCacheMode,
  ValkeyCacheResponse,
  DynamicConfigField,
  DynamicConfigFieldType,
  DynamicConfigOptions,
  ScanAndUnlinkKeysClient,
  ScanAndUnlinkKeysOptions,
  ScanAndUnlinkKeysResult,
  ExpireKeysWithNoExpiryOptions,
  ExpireKeysWithNoExpiryResult,
} from "./types.mts";
