import { handleValkeyError } from "./errors.mts";
import { glideStringToString, scanKeyPages, throwIfAborted } from "./scan.mts";
import type {
  ScanAndUnlinkKeysClient,
  ScanAndUnlinkKeysOptions,
  ScanAndUnlinkKeysResult,
} from "./types.mts";

const DEFAULT_SCAN_COUNT = 500;

export async function deleteKeysWithPrefix(
  client: ScanAndUnlinkKeysClient,
  pattern: string,
): Promise<void> {
  await scanAndUnlinkKeys(client, pattern);
}

export async function deleteKeysWithLiteralPrefixes(
  client: ScanAndUnlinkKeysClient,
  pattern: string,
  prefixes: readonly string[],
): Promise<void> {
  const uniquePrefixes = [...new Set<unknown>(prefixes)].filter(
    (prefix): prefix is string => typeof prefix === "string",
  );
  if (uniquePrefixes.length === 0) return;

  await scanAndUnlinkKeys(client, pattern, {
    matches: (key) => uniquePrefixes.some((prefix) => glideStringToString(key).startsWith(prefix)),
  });
}

/**
 * Scans keys matching a Valkey pattern and unlinks keys accepted by an optional predicate.
 *
 * SCAN is non-snapshot: concurrent writes can make the returned counts include duplicates,
 * omit keys, or differ from the number of keys that exist when this function returns.
 */
export async function scanAndUnlinkKeys(
  client: ScanAndUnlinkKeysClient,
  pattern: string,
  { signal, matches = () => true }: ScanAndUnlinkKeysOptions = {},
): Promise<ScanAndUnlinkKeysResult> {
  try {
    let scannedKeys = 0;
    let matchedKeys = 0;
    let unlinkedKeys = 0;

    for await (const scanned of scanKeyPages(client, pattern, {
      count: DEFAULT_SCAN_COUNT,
      signal,
    })) {
      scannedKeys += scanned.length;
      const keys = scanned.filter(matches);
      throwIfAborted(signal);
      matchedKeys += keys.length;

      if (keys.length > 0) {
        throwIfAborted(signal);
        unlinkedKeys += await client.unlink(keys);
        throwIfAborted(signal);
      }
    }

    return { scannedKeys, matchedKeys, unlinkedKeys };
  } catch (err) {
    if (signal?.aborted && err === signal.reason) throw err;
    handleValkeyError(err);
    throw err;
  }
}

export type ScanAndUnlinkKeyPrefixesResult = { unlinkedKeys: number };

function escapeGlobLiteral(value: string): string {
  return value.replace(/[\\*?[\]]/g, "\\$&");
}

/**
 * Unlinks every key that starts with any of the literal prefixes, scanning one prefix at a time.
 *
 * Each prefix is glob-escaped, so `*`, `?`, `[`, `]` and `\` match literally. A failing prefix does
 * not stop later prefixes. One failure is rethrown as-is; several are combined into an
 * `AggregateError` with an `unlinkedKeys` property. Failures reach the Valkey error handler once,
 * through `scanAndUnlinkKeys`. An aborted `signal` rethrows its exact reason immediately.
 */
export async function scanAndUnlinkKeyPrefixes(
  client: ScanAndUnlinkKeysClient,
  prefixes: readonly string[],
  options: ScanAndUnlinkKeysOptions = {},
): Promise<ScanAndUnlinkKeyPrefixesResult> {
  for (const prefix of prefixes) {
    if (typeof prefix !== "string" || prefix === "") {
      throw new TypeError("scanAndUnlinkKeyPrefixes prefixes must be non-empty strings");
    }
  }

  const { signal } = options;
  const failures: unknown[] = [];
  let unlinkedKeys = 0;

  for (const prefix of new Set(prefixes)) {
    throwIfAborted(signal);
    try {
      const result = await scanAndUnlinkKeys(client, `${escapeGlobLiteral(prefix)}*`, options);
      unlinkedKeys += result.unlinkedKeys;
    } catch (err) {
      if (signal?.aborted && err === signal.reason) throw err;
      failures.push(err);
    }
  }

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw Object.assign(
      new AggregateError(
        failures,
        `${failures.length} prefix scans failed after unlinking ${unlinkedKeys} keys`,
      ),
      { unlinkedKeys },
    );
  }
  return { unlinkedKeys };
}
