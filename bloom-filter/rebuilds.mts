import { emitValkeyEvent } from "../events.mts";
import { handleValkeyError } from "../errors.mts";
import { chunkItems, concurrentSlices } from "./batching.mts";
import { bloomFilterEnsureExistsScript, bloomFilterReserveScript } from "./scripts.mts";
import type { BloomFilterState } from "./types.mts";

export async function rebuild(state: BloomFilterState, items: string[]): Promise<void> {
  const { batchSize } = state;
  await rebuildFromStream(
    state,
    (async function* () {
      for (let i = 0; i < items.length; i += batchSize) {
        yield items.slice(i, i + batchSize);
      }
    })(),
  );
}

async function processBatch(state: BloomFilterState, batch: string[]): Promise<void> {
  // ⚡ Bolt Optimization:
  // What: Concurrent BF.MADD chunk processing
  // Why: Chunks are commutative. Sending them concurrently reduces wall-clock latency via pipelining/overlap.
  // Impact: Performance improvement proportional to batch size by fanning out chunked additions.
  const chunks = Array.from(chunkItems(batch, state.batchSize));
  const results: boolean[] = Array.from({ length: chunks.length }, () => false);
  let firstError: unknown;

  // We process chunks with a fixed concurrency limit to avoid overloading the client/network.
  // We must also wait for all in-flight commands in a concurrent set to settle before
  // potentially cleaning up or throwing, ensuring no "late" writes recreate the buildingKey.
  for (const { start, slice } of concurrentSlices(chunks, state.concurrencyLimit)) {
    const sliceLen = slice.length;
    // ⚡ Bolt Optimization:
    // What: Pre-allocate array and use a for loop instead of slice.map.
    // Why: Avoids iterator closure overhead and dynamic array sizing in this hot path.
    // Impact: Lower GC allocation pressure and faster concurrent batch processing.
    // eslint-disable-next-line unicorn/no-new-array
    const promises = new Array<Promise<unknown>>(sliceLen);
    for (let j = 0; j < sliceLen; j++) {
      promises[j] = state.client.customCommand(["BF.MADD", state.buildingKey, ...slice[j]!]);
    }
    const settled = await Promise.allSettled(promises);

    for (let j = 0; j < settled.length; j++) {
      const res = settled[j];
      if (res.status === "fulfilled") {
        results[start + j] = true;
      } else if (firstError === undefined) {
        firstError = res.reason;
      }
    }

    // Emit events for this concurrent slice in order before moving to the next slice
    // or throwing an error, maintaining sequential event ordering for consumers.
    for (let j = 0; j < settled.length; j++) {
      if (results[start + j]) {
        emitValkeyEvent("bloom-filter:add", { name: state.name, items: slice[j]! });
      }
    }

    if (firstError !== undefined) break;
  }

  if (firstError !== undefined) throw firstError;
}

export async function rebuildFromStream(
  state: BloomFilterState,
  batches: AsyncIterable<string[]>,
  capacityOverride?: number,
): Promise<void> {
  const capacityToUse = capacityOverride ?? state.capacity;
  await state.client.invokeScript(bloomFilterReserveScript, {
    keys: [state.buildingKey],
    args: [state.errorRate.toString(), capacityToUse.toString(), state.expansionRate.toString()],
  });
  try {
    for await (const batch of batches) {
      await processBatch(state, batch);
    }
    await state.client.rename(state.buildingKey, state.liveKey);
  } catch (error) {
    await cleanupBuildingKey(state);
    throw error;
  }
}

export async function deleteBloomFilter(state: BloomFilterState): Promise<void> {
  await state.client.unlink([state.liveKey, state.buildingKey]);
}

export async function deleteWithAdditionalKeys(
  state: BloomFilterState,
  additionalKeys: string[],
): Promise<void> {
  await state.client.unlink([state.liveKey, state.buildingKey, ...additionalKeys]);
}

export async function keyExists(state: BloomFilterState): Promise<boolean> {
  const result = await state.client.customCommand(["EXISTS", state.liveKey]);
  return result === 1 || result === 1n;
}

export async function isReady(state: BloomFilterState, readyKey: string): Promise<boolean> {
  const result = await state.client.customCommand(["EXISTS", readyKey, state.liveKey]);
  return result === 2 || result === 2n;
}

export async function ensureExists(state: BloomFilterState, capacity?: number): Promise<void> {
  const capacityToUse = capacity ?? state.capacity;
  await state.client.invokeScript(bloomFilterEnsureExistsScript, {
    keys: [state.liveKey],
    args: [state.errorRate.toString(), capacityToUse.toString(), state.expansionRate.toString()],
  });
}

async function cleanupBuildingKey(state: BloomFilterState): Promise<void> {
  try {
    await state.client.unlink([state.buildingKey]);
  } catch (cleanupError) {
    handleValkeyError(cleanupError as Error);
  }
}
