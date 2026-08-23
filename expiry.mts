import {
  Batch,
  ExpireOptions,
  type GlideClient,
} from "@valkey/valkey-glide";
import { handleValkeyError } from "./errors.mts";
import { scanKeyPages, throwIfAborted } from "./scan.mts";
import type { ExpireKeysWithNoExpiryOptions, ExpireKeysWithNoExpiryResult } from "./types.mts";

const DEFAULT_SCAN_COUNT = 500;
const DEFAULT_BATCH_SIZE = 500;

/**
 * Sets a TTL only on matching keys that have no existing expiry.
 *
 * SCAN is non-snapshot: concurrent writes can make the returned counts include duplicates,
 * omit keys, or differ from the number of keys that exist when this function returns.
 */
export async function expireKeysWithNoExpiry(
  client: GlideClient,
  {
    pattern,
    ttl,
    shouldExpire = () => true,
    signal,
    scanCount = DEFAULT_SCAN_COUNT,
    batchSize = DEFAULT_BATCH_SIZE,
  }: ExpireKeysWithNoExpiryOptions,
): Promise<ExpireKeysWithNoExpiryResult> {
  validateExpirySweepOptions(ttl, scanCount, batchSize);

  try {
    let scannedKeys = 0;
    let matchedKeys = 0;
    let expiredKeys = 0;

    for await (const scanned of scanKeyPages(client, pattern, { count: scanCount, signal })) {
      scannedKeys += scanned.length;

      const keys = scanned.filter(shouldExpire);
      throwIfAborted(signal);
      matchedKeys += keys.length;
      if (keys.length === 0) continue;

      for (let offset = 0; offset < keys.length; offset += batchSize) {
        throwIfAborted(signal);
        const batchKeys = keys.slice(offset, offset + batchSize);
        const batch = new Batch(false);
        for (const key of batchKeys) {
          batch.expire(key, ttl, { expireOption: ExpireOptions.HasNoExpiry });
        }

        const results = await client.exec(batch, true);
        throwIfAborted(signal);
        if (!Array.isArray(results) || results.length !== batchKeys.length) {
          throw new Error("expireKeysWithNoExpiry: unexpected EXPIRE batch response");
        }
        for (const result of results) {
          if (result === true) expiredKeys += 1;
        }
      }
    }

    return { scannedKeys, matchedKeys, expiredKeys };
  } catch (error) {
    if (signal?.aborted && error === signal.reason) throw error;
    handleValkeyError(error);
    throw error;
  }
}

function validateExpirySweepOptions(ttl: number, scanCount: number, batchSize: number): void {
  if (!Number.isSafeInteger(ttl) || ttl <= 0) {
    throw new RangeError("expireKeysWithNoExpiry: ttl must be a positive safe integer");
  }
  if (!Number.isSafeInteger(scanCount) || scanCount <= 0) {
    throw new RangeError("expireKeysWithNoExpiry: scanCount must be a positive safe integer");
  }
  if (!Number.isSafeInteger(batchSize) || batchSize <= 0) {
    throw new RangeError("expireKeysWithNoExpiry: batchSize must be a positive safe integer");
  }
}
