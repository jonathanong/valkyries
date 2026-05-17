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
    let previous = Promise.resolve();
    for (const chunk of chunkItems(batch, luaBatchSize(state.batchSize))) {
      previous = previous.then(async () => {
        const result = await state.client.invokeScript(bloomFilterAddScript, {
          keys: [state.liveKey, state.buildingKey],
          args: chunk,
        });
        if (wroteFilter(result)) {
          emitValkeyEvent("bloom-filter:add", { name: state.name, items: chunk });
        }
      });
    }
    await previous;
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
