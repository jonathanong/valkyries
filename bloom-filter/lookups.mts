import { emitValkeyEvent } from "../events.mts";
import { handleValkeyError } from "../errors.mts";
import { luaBatchSize } from "./batching.mts";
import {
  bloomFilterExistsIfReadyScript,
  bloomFilterExistsScript,
  bloomFilterMexistsIfReadyScript,
  bloomFilterMexistsScript,
} from "./scripts.mts";
import type { BloomFilterState } from "./types.mts";
import { normalizeBloomCheckResult } from "./results.mts";

export async function exists(state: BloomFilterState, item: string): Promise<boolean | null> {
  try {
    const result = await state.client.invokeScript(bloomFilterExistsScript, {
      keys: [state.liveKey],
      args: [item],
    });
    if (result === -1 || result === -1n) {
      emitValkeyEvent("bloom-filter:exists", { name: state.name, item, result: null });
      return null;
    }
    const boolResult = result === 1 || result === 1n;
    emitValkeyEvent("bloom-filter:exists", { name: state.name, item, result: boolResult });
    return boolResult;
  } catch (error) {
    handleValkeyError(error as Error);
    return null;
  }
}

export async function mexists(
  state: BloomFilterState,
  items: string[],
): Promise<(boolean | null)[]> {
  const len = items.length;
  if (len === 0) return [];
  const batches = buildBatches(items, luaBatchSize(state.batchSize));
  try {
    // ⚡ Bolt Optimization:
    // What: Pre-allocate array and use an indexed loop instead of .map() for script invocations.
    // Why: Avoids iterator overhead for dynamic array allocation in this batching hot path.
    // eslint-disable-next-line unicorn/no-new-array
    const promises = new Array<Promise<unknown>>(batches.length);
    for (let i = 0; i < batches.length; i++) {
      promises[i] = state.client.invokeScript(bloomFilterMexistsScript, {
        keys: [state.liveKey],
        args: batches[i]!,
      });
    }
    const batchResults = await Promise.all(promises);
    const boolResults = normalizeBatchedResults(batches, batchResults);
    emitValkeyEvent("bloom-filter:mexists", { name: state.name, items, results: boolResults });
    return boolResults;
  } catch (error) {
    handleValkeyError(error as Error);
    // eslint-disable-next-line unicorn/no-new-array
    return new Array<null>(len).fill(null);
  }
}

export async function existsIfReady(
  state: BloomFilterState,
  readyKey: string,
  item: string,
): Promise<boolean | null> {
  try {
    const result = await state.client.invokeScript(bloomFilterExistsIfReadyScript, {
      keys: [readyKey, state.liveKey],
      args: [item],
    });
    const normalized = normalizeBloomCheckResult(result);
    emitValkeyEvent("bloom-filter:exists", { name: state.name, item, result: normalized });
    return normalized;
  } catch (error) {
    handleValkeyError(error as Error);
    return null;
  }
}

export async function mexistsIfReady(
  state: BloomFilterState,
  readyKey: string,
  items: string[],
): Promise<(boolean | null)[]> {
  const len = items.length;
  if (len === 0) return [];
  const batches = buildBatches(items, luaBatchSize(state.batchSize));
  try {
    // ⚡ Bolt Optimization:
    // What: Pre-allocate array and use an indexed loop instead of .map() for script invocations.
    // Why: Avoids iterator overhead for dynamic array allocation in this batching hot path.
    // eslint-disable-next-line unicorn/no-new-array
    const promises = new Array<Promise<unknown>>(batches.length);
    for (let i = 0; i < batches.length; i++) {
      promises[i] = state.client.invokeScript(bloomFilterMexistsIfReadyScript, {
        keys: [readyKey, state.liveKey],
        args: batches[i]!,
      });
    }
    const batchResults = await Promise.all(promises);
    const normalizedResults = normalizeBatchedResults(batches, batchResults);
    emitValkeyEvent("bloom-filter:mexists", {
      name: state.name,
      items,
      results: normalizedResults,
    });
    return normalizedResults;
  } catch (error) {
    handleValkeyError(error as Error);
    // eslint-disable-next-line unicorn/no-new-array
    return new Array<null>(len).fill(null);
  }
}

function buildBatches(items: string[], batchSize: number): string[][] {
  const batches: string[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }
  return batches;
}

function normalizeBatchedResults(batches: string[][], batchResults: unknown[]): (boolean | null)[] {
  const boolResults: (boolean | null)[] = [];
  for (let i = 0; i < batches.length; i++) {
    const batchItems = batches[i]!;
    const results = batchResults[i];
    if (!Array.isArray(results)) {
      boolResults.push(...batchItems.map((): null => null));
    } else {
      boolResults.push(...results.map(normalizeBloomCheckResult));
    }
  }
  return boolResults;
}
