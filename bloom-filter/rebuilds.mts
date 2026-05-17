import { emitValkeyEvent } from "../events.mts";
import { handleValkeyError } from "../errors.mts";
import { chunkItems } from "./batching.mts";
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
      let previous = Promise.resolve();
      for (const chunk of chunkItems(batch, state.batchSize)) {
        previous = previous.then(async () => {
          await state.client.customCommand(["BF.MADD", state.buildingKey, ...chunk]);
          emitValkeyEvent("bloom-filter:add", { name: state.name, items: chunk });
        });
      }
      await previous;
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
