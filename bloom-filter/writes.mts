import { emitValkeyEvent } from "../events.mts";
import { handleValkeyError } from "../errors.mts";
import { chunkItems, luaBatchSize } from "./batching.mts";
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
    // What: Replaced sequential Promise chain with Promise.all()
    // Why: BF.MADD commands are commutative, so chunks can be sent to Valkey concurrently instead of waiting for the previous chunk to finish.
    // Impact: Significantly reduces network latency for large batches (from O(n) to O(1) round trips per batch)
    const promises: Promise<void>[] = [];
    for (const chunk of chunkItems(batch, luaBatchSize(state.batchSize))) {
      promises.push(
        (async () => {
          const result = await state.client.invokeScript(bloomFilterAddScript, {
            keys: [state.liveKey, state.buildingKey],
            args: chunk,
          });
          if (wroteFilter(result)) {
            emitValkeyEvent("bloom-filter:add", { name: state.name, items: chunk });
          }
        })(),
      );
    }
    await Promise.all(promises);
  }
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
