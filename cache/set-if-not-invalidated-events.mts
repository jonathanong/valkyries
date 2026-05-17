import { emitValkeyEvent } from "../events.mts";

export function emitSetIfNotInvalidatedEvents(
  prefix: string,
  entries: Array<{ serializedKey: string }>,
  results: unknown,
) {
  const writtenKeys = Array.isArray(results)
    ? entries.flatMap((entry, index) => {
        const result = results[index];
        return result === 1 || result === 1n ? [entry.serializedKey] : [];
      })
    : entries.map((entry) => entry.serializedKey);
  const skippedKeys =
    Array.isArray(results) && results.length === entries.length
      ? entries.flatMap((entry, index) => {
          const result = results[index];
          return result === 0 || result === 0n ? [entry.serializedKey] : [];
        })
      : [];
  if (writtenKeys.length > 0)
    emitValkeyEvent("cache:set", { cacheName: prefix, keys: writtenKeys });
  if (skippedKeys.length > 0) {
    emitValkeyEvent("cache:set-skipped", { cacheName: prefix, keys: skippedKeys });
  }
}
