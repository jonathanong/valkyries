import { Buffer } from "node:buffer";
import { handleValkeyError } from "./errors.mts";
import type { ScanAndUnlinkKeysOptions, ScanAndUnlinkKeysResult } from "./types.mts";
import type { GlideClient, GlideString } from "@valkey/valkey-glide";

const DEFAULT_SCAN_COUNT = 500;

export async function deleteKeysWithPrefix(client: GlideClient, pattern: string): Promise<void> {
  await scanAndUnlinkKeys(client, pattern);
}

export async function deleteKeysWithLiteralPrefixes(
  client: GlideClient,
  pattern: string,
  prefixes: readonly string[],
): Promise<void> {
  const uniquePrefixes = [...new Set<unknown>(prefixes)].filter(
    (prefix): prefix is string => typeof prefix === "string",
  );
  if (uniquePrefixes.length === 0) return;

  await scanAndUnlinkKeys(client, pattern, {
    matches: (key) => uniquePrefixes.some((prefix) => keyToString(key).startsWith(prefix)),
  });
}

/**
 * Scans keys matching a Valkey pattern and unlinks keys accepted by an optional predicate.
 *
 * SCAN is non-snapshot: concurrent writes can make the returned counts include duplicates,
 * omit keys, or differ from the number of keys that exist when this function returns.
 */
export async function scanAndUnlinkKeys(
  client: GlideClient,
  pattern: string,
  { signal, matches = () => true }: ScanAndUnlinkKeysOptions = {},
): Promise<ScanAndUnlinkKeysResult> {
  try {
    let cursor = "0";
    let scannedKeys = 0;
    let matchedKeys = 0;
    let unlinkedKeys = 0;

    do {
      throwIfAborted(signal);
      const result = await client.scan(cursor, { match: pattern, count: DEFAULT_SCAN_COUNT });
      throwIfAborted(signal);
      cursor = keyToString(result[0]);
      const scanned = result[1] as GlideString[];
      scannedKeys += scanned.length;
      const keys = scanned.filter(matches);
      matchedKeys += keys.length;

      if (keys.length > 0) {
        throwIfAborted(signal);
        unlinkedKeys += await client.unlink(keys);
        throwIfAborted(signal);
      }
    } while (cursor !== "0");

    return { scannedKeys, matchedKeys, unlinkedKeys };
  } catch (err) {
    if (signal?.aborted && err === signal.reason) throw err;
    handleValkeyError(err);
    throw err;
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason;
}

function keyToString(key: GlideString): string {
  return typeof key === "string" ? key : Buffer.from(key).toString("utf8");
}
