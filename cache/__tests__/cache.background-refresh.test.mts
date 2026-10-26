import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ValkeyCache } from "../../cache.mts";
import { cacheValkeyClient } from "../../clients.mts";
import { setValkeyErrorHandler } from "../../errors.mts";

type Value = { id: string; version: number };

const als = new AsyncLocalStorage<string>();

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

function uniqueKey(label: string) {
  return `bg-${label}-${Math.random().toString(36).slice(2)}`;
}

// ttlSeconds 10 with staleTtlAge 0.8 gives a 2s refresh window, so a 1s TTL is stale
function makeCache(runBackgroundRefresh?: (refresh: () => Promise<void>) => Promise<void>) {
  return new ValkeyCache({ prefix: "bg", ttlSeconds: 10, staleTtlAge: 0.8, runBackgroundRefresh });
}

async function seedStale(cache: ValkeyCache, key: string) {
  await cache.set(key, { id: key, version: 1 });
  await cacheValkeyClient.expire(cache.getKey(key), 1);
}

function captureErrors() {
  const errors: Error[] = [];
  setValkeyErrorHandler((error) => errors.push(error));
  return errors;
}

describe("cache.background-refresh", () => {
  afterEach(() => {
    setValkeyErrorHandler(() => {});
  });

  it("rejects a non-function runBackgroundRefresh", () => {
    expect(
      () =>
        new ValkeyCache({
          prefix: "bg",
          ttlSeconds: 10,
          runBackgroundRefresh: "nope" as unknown as () => Promise<void>,
        }),
    ).toThrow("ValkeyCache: runBackgroundRefresh must be a function");
  });

  it("runs the batch stale refresh in the caller's context by default", async () => {
    const cache = makeCache();
    const stale = uniqueKey("stale");
    const cold = uniqueKey("cold");
    await seedStale(cache, stale);
    const calls: Array<{ keys: string[]; store: string | undefined }> = [];
    const read = cache.cacheGetByAnyBatch((keys: string[]) => {
      calls.push({ keys, store: als.getStore() });
      return Promise.resolve(keys.map((id) => ({ id, version: 2 })));
    });

    const result = await als.run("request", () => read([stale, cold]));

    expect(result).toEqual([
      { id: stale, version: 1 },
      { id: cold, version: 2 },
    ]);
    expect(calls).toEqual([
      { keys: [stale], store: "request" },
      { keys: [cold], store: "request" },
    ]);
    await waitFor(async () => ((await cache.get(stale)) as Value | null)?.version === 2);
    await cache.delete(stale, cold);
  });

  it("wraps only the batch stale refresh, not the awaited cold-miss call", async () => {
    const wrapper = vi.fn((refresh: () => Promise<void>) => als.run("background", refresh));
    const cache = makeCache(wrapper);
    const stale = uniqueKey("stale");
    const cold = uniqueKey("cold");
    await seedStale(cache, stale);
    const calls: Array<{ keys: string[]; store: string | undefined }> = [];
    const read = cache.cacheGetByAnyBatch((keys: string[]) => {
      calls.push({ keys, store: als.getStore() });
      return Promise.resolve(keys.map((id) => ({ id, version: 2 })));
    });

    const result = await als.run("request", () => read([stale, cold]));

    expect(result).toEqual([
      { id: stale, version: 1 },
      { id: cold, version: 2 },
    ]);
    expect(wrapper).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      { keys: [stale], store: "background" },
      { keys: [cold], store: "request" },
    ]);
    await waitFor(async () => ((await cache.get(stale)) as Value | null)?.version === 2);
    await cache.delete(stale, cold);
  });

  it("wraps the single-key stale refresh, not the awaited miss", async () => {
    const wrapper = vi.fn((refresh: () => Promise<void>) => als.run("background", refresh));
    const cache = makeCache(wrapper);
    const stale = uniqueKey("stale");
    const cold = uniqueKey("cold");
    await seedStale(cache, stale);
    const calls: Array<{ key: string; store: string | undefined }> = [];
    const read = cache.cacheGetByAny((key: string) => {
      calls.push({ key, store: als.getStore() });
      return Promise.resolve({ id: key, version: 2 });
    });

    expect(await als.run("request", () => read(cold))).toEqual({ id: cold, version: 2 });
    expect(wrapper).not.toHaveBeenCalled();
    expect(await als.run("request", () => read(stale))).toEqual({ id: stale, version: 1 });
    expect(wrapper).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      { key: cold, store: "request" },
      { key: stale, store: "background" },
    ]);
    await waitFor(async () => ((await cache.get(stale)) as Value | null)?.version === 2);
    await cache.delete(stale, cold);
  });

  it("reports a rejecting wrapper without failing the read or blocking later refreshes", async () => {
    const errors = captureErrors();
    const wrapper = vi.fn(() => Promise.reject(new Error("wrapper rejected")));
    const cache = makeCache(wrapper);
    const stale = uniqueKey("stale");
    await seedStale(cache, stale);
    const batchFn = vi.fn((keys: string[]) =>
      Promise.resolve(keys.map((id) => ({ id, version: 2 }))),
    );
    const read = cache.cacheGetByAnyBatch(batchFn);

    expect(await read([stale])).toEqual([{ id: stale, version: 1 }]);
    await waitFor(() => errors.length === 1);
    expect(errors[0]!.message).toBe("wrapper rejected");
    expect(batchFn).not.toHaveBeenCalled();

    // The pending marker was cleared, so the next stale hit starts another refresh
    expect(await read([stale])).toEqual([{ id: stale, version: 1 }]);
    expect(wrapper).toHaveBeenCalledTimes(2);
    await waitFor(() => errors.length === 2);
    await cache.delete(stale);
  });

  it("reports a synchronously throwing wrapper without failing the read", async () => {
    const errors = captureErrors();
    const wrapper = vi.fn((): Promise<void> => {
      throw new Error("wrapper threw");
    });
    const cache = makeCache(wrapper);
    const stale = uniqueKey("stale");
    await seedStale(cache, stale);
    const read = cache.cacheGetByAny((key: string) => Promise.resolve({ id: key, version: 2 }));

    expect(await read(stale)).toEqual({ id: stale, version: 1 });
    expect(errors.map((error) => error.message)).toEqual(["wrapper threw"]);
    expect(await read(stale)).toEqual({ id: stale, version: 1 });
    expect(wrapper).toHaveBeenCalledTimes(2);
    await cache.delete(stale);
  });

  it("reports a failed refresh once even when the wrapper awaits it", async () => {
    const errors = captureErrors();
    let settled: Promise<void> | undefined;
    const cache = makeCache((refresh) => (settled = refresh()));
    const stale = uniqueKey("stale");
    await seedStale(cache, stale);
    const read = cache.cacheGetByAnyBatch((): Promise<Value[]> =>
      Promise.reject(new Error("refresh failed")),
    );

    expect(await read([stale])).toEqual([{ id: stale, version: 1 }]);
    await expect(settled).resolves.toBeUndefined();
    await waitFor(() => errors.length > 0);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(errors.map((error) => error.message)).toEqual(["refresh failed"]);
    await cache.delete(stale);
  });

  it("runs the refresh at most once when the wrapper calls it repeatedly", async () => {
    const cache = makeCache(async (refresh) => {
      await Promise.all([refresh(), refresh()]);
      await refresh();
    });
    const stale = uniqueKey("stale");
    await seedStale(cache, stale);
    const fetchValue = vi.fn((key: string) => Promise.resolve({ id: key, version: 2 }));
    const read = cache.cacheGetByAny(fetchValue);

    expect(await read(stale)).toEqual({ id: stale, version: 1 });
    await waitFor(async () => ((await cache.get(stale)) as Value | null)?.version === 2);
    expect(fetchValue).toHaveBeenCalledTimes(1);
    await cache.delete(stale);
  });
});
