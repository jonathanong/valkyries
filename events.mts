import { EventEmitter } from "node:events";
import { handleValkeyError } from "./errors.mts";
export interface ValkeyEventMap {
  "cache:call": [
    {
      cacheName: string;
      batch: boolean;
      hits: number;
      misses: number;
      bloomMisses: number;
      durationMs: number;
    },
  ];
  "rate-limiter:add": [{ prefix: string; ids: string[] }];
  "rate-limiter:get": [{ prefix: string; ids: string[]; counts: number[] }];
  "rate-limiter:delete": [{ prefix: string; ids: string[] }];
  "rate-limiter:invalidate": [{ prefix: string }];
  "cache:hit": [{ cacheName: string; keys: string[]; count: number }];
  "cache:miss": [{ cacheName: string; keys: string[]; count: number }];
  "cache:bloom-miss": [{ cacheName: string; keys: string[]; count: number }];
  "cache:set": [{ cacheName: string; keys: string[] }];
  "cache:set-skipped": [{ cacheName: string; keys: string[] }];
  "cache:delete": [{ cacheName: string; keys: string[] }];
  "cache:invalidate": [{ cacheName: string }];
  "bloom-filter:exists": [{ name: string; item: string; result: boolean | null }];
  "bloom-filter:mexists": [{ name: string; items: string[]; results: (boolean | null)[] }];
  /**
   * Emitted after each write to the filter:
   * - `add()`: fires once with all items after all internal batches complete (aggregate event)
   * - `addStream()` and `rebuildFromStream()`: fires once per batch chunk
   * During a rebuild, items are written to a staging key and not yet visible in the live
   * filter until the atomic rename completes — do not treat this event as confirmation of
   * live filter membership.
   */
  "bloom-filter:add": [{ name: string; items: string[] }];
}

export const valkeyEvents = new EventEmitter<ValkeyEventMap>();
/* v8 ignore next -- NODE_ENV is controlled by the test runner. */
if (process.env.NODE_ENV === "test") {
  // Allow up to 1000 listeners — tests register multiple per-event handlers across parallel workers.
  valkeyEvents.setMaxListeners(1000);
}

export function emitValkeyEvent<K extends keyof ValkeyEventMap>(
  event: K,
  ...args: ValkeyEventMap[K]
) {
  try {
    // @ts-expect-error TypeScript cannot resolve conditional types in EventEmitter.emit for generic K
    valkeyEvents.emit(event, ...args);
  } catch (err) {
    handleValkeyError(err);
  }
}
