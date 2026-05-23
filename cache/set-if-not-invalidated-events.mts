import { emitValkeyEvent } from "../events.mts";

export function emitSetIfNotInvalidatedEvents(
  prefix: string,
  entries: Array<{ serializedKey: string }>,
  results: unknown,
) {
  const writtenKeys: string[] = [];
  const skippedKeys: string[] = [];

  // ⚡ Bolt Optimization:
  // What: Use indexed loops for set/invalidation event routing.
  // Why: Avoids iterator overhead while keeping result and entry indexes aligned.
  // Impact: Reduces GC pressure and improves throughput for batch operations.
  if (Array.isArray(results)) {
    const isCompleteResult = results.length === entries.length;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const result = results[i];
      if (result == null) continue;
      if (result === 1 || result === 1n) {
        writtenKeys.push(entry.serializedKey);
      } else if (isCompleteResult && (result === 0 || result === 0n)) {
        skippedKeys.push(entry.serializedKey);
      }
    }
  } else {
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      writtenKeys.push(entry.serializedKey);
    }
  }
  if (writtenKeys.length > 0)
    emitValkeyEvent("cache:set", { cacheName: prefix, keys: writtenKeys });
  if (skippedKeys.length > 0) {
    emitValkeyEvent("cache:set-skipped", { cacheName: prefix, keys: skippedKeys });
  }
}
