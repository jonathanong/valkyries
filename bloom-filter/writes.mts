import { emitValkeyEvent } from "../events.mts";
import { handleValkeyError } from "../errors.mts";
import { retrySaturationError } from "../retry.mts";
import { chunkItems, concurrentSlices, luaBatchSize } from "./batching.mts";
import { bloomFilterAddScript } from "./scripts.mts";
import type { BloomFilterState } from "./types.mts";

export function add(state: BloomFilterState, items: string[]): Promise<void> {
  if (items.length === 0) return Promise.resolve();
  return runAddCommands(state, items)
    .then((results) => {
      if (results.some(wroteFilter)) {
        emitValkeyEvent("bloom-filter:add", { name: state.name, items });
      }
    })
    .catch(handleValkeyError);
}

export async function addOrThrow(state: BloomFilterState, items: string[]): Promise<void> {
  if (items.length === 0) return;
  const results = await runAddCommands(state, items);
  if (results.some(wroteFilter)) {
    emitValkeyEvent("bloom-filter:add", { name: state.name, items });
  }
}

export async function addStream(
  state: BloomFilterState,
  batches: AsyncIterable<string[]>,
): Promise<void> {
  for await (const batch of batches) {
    // ⚡ Bolt Optimization:
    // What: Concurrent BF.MADD chunk processing
    // Why: Chunks are commutative. Sending them concurrently reduces wall-clock latency via pipelining/overlap.
    // Impact: Performance improvement proportional to batch size by fanning out chunked additions.
    const chunks = Array.from(chunkItems(batch, luaBatchSize(state.batchSize)));
    const results: unknown[] = Array.from({ length: chunks.length });
    let firstError: any;

    // We process chunks with a fixed concurrency limit to avoid overloading the client/network.
    // We must also wait for all in-flight commands in a concurrent set to settle before
    // potentially throwing, ensuring no "late" writes happen after the method returns.
    for (const { start, slice } of concurrentSlices(chunks, state.concurrencyLimit)) {
      const settled = await Promise.allSettled(slice.map((chunk) => invokeAddScript(state, chunk)));

      for (let j = 0; j < settled.length; j++) {
        const res = settled[j];
        if (res.status === "fulfilled") {
          results[start + j] = res.value;
        } else if (firstError === undefined) {
          firstError = res.reason;
        }
      }

      // Emit events for this concurrent slice in order before moving to the next slice
      // or throwing an error, maintaining sequential event ordering for consumers.
      for (let j = 0; j < settled.length; j++) {
        if (wroteFilter(results[start + j])) {
          emitValkeyEvent("bloom-filter:add", { name: state.name, items: slice[j] });
        }
      }

      if (firstError !== undefined) break;
    }

    if (firstError !== undefined) {
      throw firstError;
    }
  }
}

async function runAddCommands(state: BloomFilterState, items: string[]): Promise<unknown[]> {
  const chunks = Array.from(chunkItems(items, luaBatchSize(state.batchSize)));
  const results: unknown[] = [];
  for (const { slice } of concurrentSlices(chunks, state.concurrencyLimit)) {
    const settled = await Promise.allSettled(slice.map((chunk) => invokeAddScript(state, chunk)));
    let firstError: unknown;
    for (const result of settled) {
      if (result.status === "fulfilled") {
        results.push(result.value);
      } else if (firstError === undefined) {
        firstError = result.reason;
      }
    }
    if (firstError !== undefined) throw firstError;
  }
  return results;
}

function invokeAddScript(state: BloomFilterState, items: string[]): Promise<unknown> {
  return retrySaturationError(
    () =>
      state.client.invokeScript(bloomFilterAddScript, {
        keys: [state.liveKey, state.buildingKey],
        args: items,
      }),
    { attempts: state.inflightRetryAttempts, delayMs: state.inflightRetryDelayMs },
  );
}

function wroteFilter(result: unknown): boolean {
  return result === 1 || result === 1n;
}
