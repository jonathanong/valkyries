import { emitValkeyEvent } from "../events.mts";
import { handleValkeyError } from "../errors.mts";
import { chunkItems, DEFAULT_BLOOM_FILTER_CONCURRENCY_LIMIT, luaBatchSize } from "./batching.mts";
import { bloomFilterAddScript } from "./scripts.mts";
import type { BloomFilterState } from "./types.mts";

export function add(state: BloomFilterState, items: string[]): Promise<void> {
  if (items.length === 0) return Promise.resolve();
  return Promise.all(addCommands(state, items))
    .then((results) => {
      if (results.some(wroteFilter)) {
        emitValkeyEvent("bloom-filter:add", { name: state.name, items });
      }
    })
    .catch(handleValkeyError);
}

export async function addOrThrow(state: BloomFilterState, items: string[]): Promise<void> {
  if (items.length === 0) return;
  const results = await Promise.all(addCommands(state, items));
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
    let firstError: unknown;

    // We process chunks with a fixed concurrency limit to avoid overloading the client/network.
    // We must also wait for all in-flight commands in a concurrent set to settle before
    // potentially throwing, ensuring no "late" writes happen after the method returns.
    const concurrencyLimit = DEFAULT_BLOOM_FILTER_CONCURRENCY_LIMIT;
    for (let i = 0; i < chunks.length; i += concurrencyLimit) {
      firstError = await processChunkSlice(state, chunks, i, concurrencyLimit, results);

      if (firstError !== undefined) break;
    }

    if (firstError !== undefined) {
      throw firstError;
    }
  }
}

async function processChunkSlice(
  state: BloomFilterState,
  chunks: string[][],
  startIndex: number,
  concurrencyLimit: number,
  results: unknown[],
): Promise<unknown | undefined> {
  const slice = chunks.slice(startIndex, startIndex + concurrencyLimit);
  let firstError: unknown | undefined;
  const settled = await Promise.allSettled(
    slice.map((chunk) =>
      state.client.invokeScript(bloomFilterAddScript, {
        keys: [state.liveKey, state.buildingKey],
        args: chunk,
      }),
    ),
  );

  for (let j = 0; j < settled.length; j++) {
    const res = settled[j];
    if (res.status === "fulfilled") {
      results[startIndex + j] = res.value;
    } else if (firstError === undefined) {
      firstError = res.reason;
    }
  }

  // Emit events for this concurrent slice in order before moving to the next slice
  // or throwing an error, maintaining sequential event ordering for consumers.
  for (let j = 0; j < settled.length; j++) {
    if (wroteFilter(results[startIndex + j])) {
      emitValkeyEvent("bloom-filter:add", { name: state.name, items: slice[j] });
    }
  }

  return firstError;
}

function addCommands(state: BloomFilterState, items: string[]): Promise<unknown>[] {
  const cmds: Promise<unknown>[] = [];
  for (const chunk of chunkItems(items, luaBatchSize(state.batchSize))) {
    cmds.push(
      state.client.invokeScript(bloomFilterAddScript, {
        keys: [state.liveKey, state.buildingKey],
        args: chunk,
      }),
    );
  }
  return cmds;
}

function wroteFilter(result: unknown): boolean {
  return result === 1 || result === 1n;
}
