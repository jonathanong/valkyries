import { emitValkeyEvent } from "../events.mts";

export function emitSetIfNotInvalidatedEvents(
  prefix: string,
  entries: Array<{ serializedKey: string }>,
  results: unknown,
) {
  let writtenKeys: string[];
  let skippedKeys: string[] = [];

  // ⚡ Bolt Optimization:
  // What: Replace multiple array.flatMap calls with a single indexed for loop
  // Why: flatMap creates many intermediate arrays. A single pass loop reduces allocations and iterates the array once instead of twice.
  if (Array.isArray(results)) {
    writtenKeys = [];
    const isCompleteResult = results.length === entries.length;
    for (let i = 0; i < entries.length; i++) {
      const result = results[i];
      if (result === 1 || result === 1n) {
        writtenKeys.push(entries[i].serializedKey);
      } else if (isCompleteResult && (result === 0 || result === 0n)) {
        skippedKeys.push(entries[i].serializedKey);
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
