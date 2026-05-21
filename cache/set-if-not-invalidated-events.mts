import { emitValkeyEvent } from "../events.mts";

export function emitSetIfNotInvalidatedEvents(
  prefix: string,
  entries: Array<{ serializedKey: string }>,
  results: unknown,
) {
  // ⚡ Bolt Optimization:
  // What: Replaced entries.flatMap with standard for-loops.
  // Why: flatMap allocates intermediate arrays (like [entry.serializedKey] or []) per item, generating garbage collection overhead.
  // Impact: O(N) array allocation avoided for cache set events, improving efficiency of batch insertions.
  let writtenKeys: string[];
  let skippedKeys: string[] = [];

  if (Array.isArray(results)) {
    writtenKeys = [];
    if (results.length === entries.length) {
      for (let i = 0; i < entries.length; i++) {
        const result = results[i];
        if (result === 1 || result === 1n) {
          writtenKeys.push(entries[i]!.serializedKey);
        } else if (result === 0 || result === 0n) {
          skippedKeys.push(entries[i]!.serializedKey);
        }
      }
    } else {
      // Fallback if lengths don't match for some reason, though it shouldn't happen.
      for (let i = 0; i < entries.length; i++) {
        const result = results[i];
        if (result === 1 || result === 1n) {
          writtenKeys.push(entries[i]!.serializedKey);
        }
      }
    }
  } else {
    writtenKeys = entries.map((entry) => entry.serializedKey);
  }

  if (writtenKeys.length > 0)
    emitValkeyEvent("cache:set", { cacheName: prefix, keys: writtenKeys });
  if (skippedKeys.length > 0) {
    emitValkeyEvent("cache:set-skipped", { cacheName: prefix, keys: skippedKeys });
  }
}
