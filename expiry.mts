import { Batch, ExpireOptions, type GlideClient, type GlideString } from "@valkey/valkey-glide";
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
      expiredKeys += await expireKeys(client, keys, ttl, batchSize, signal);
    }

    return { scannedKeys, matchedKeys, expiredKeys };
  } catch (error) {
    if (signal?.aborted && error === signal.reason) throw error;
    handleValkeyError(error);
    throw error;
  }
}

async function expireKeys(
  client: GlideClient,
  keys: GlideString[],
  ttl: number,
  batchSize: number,
  signal: AbortSignal | undefined,
): Promise<number> {
  let expiredKeys = 0;
  for (let offset = 0; offset < keys.length; offset += batchSize) {
    expiredKeys += await expireBatch(client, keys.slice(offset, offset + batchSize), ttl, signal);
  }
  return expiredKeys;
}

async function expireBatch(
  client: GlideClient,
  keys: GlideString[],
  ttl: number,
  signal: AbortSignal | undefined,
): Promise<number> {
  throwIfAborted(signal);
  const batch = new Batch(false);
  for (const key of keys) {
    batch.expire(key, ttl, { expireOption: ExpireOptions.HasNoExpiry });
  }

  const results = await client.exec(batch, true);
  throwIfAborted(signal);
  if (!Array.isArray(results) || results.length !== keys.length) {
    throw new Error("expireKeysWithNoExpiry: unexpected EXPIRE batch response");
  }
  let expiredKeys = 0;
  for (const result of results) {
    if (result === true) expiredKeys += 1;
  }
  return expiredKeys;
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
