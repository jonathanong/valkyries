import { Script } from "@valkey/valkey-glide";
import { afterAll, describe, expect, it } from "vitest";
import { cacheValkeyClient, rateLimiterValkeyClient } from "../clients.mts";
import { loadScript } from "../scripts.mts";

const scriptBaseUrl = new URL("../", import.meta.url);
const scriptRegistry = {
  cacheSetIfNotInvalidated: new Script(
    loadScript("cache-set-if-not-invalidated.lua", scriptBaseUrl),
  ),
  cacheDeleteWithInvalidation: new Script(
    loadScript("cache-delete-with-invalidation.lua", scriptBaseUrl),
  ),
  getValueWithTtl: new Script(loadScript("get-value-with-ttl.lua", scriptBaseUrl)),
  getValuesWithTtl: new Script(loadScript("get-values-with-ttl.lua", scriptBaseUrl)),
  bloomFilterReserve: new Script(loadScript("bloom-filter-reserve.lua", scriptBaseUrl)),
  bloomFilterEnsureExists: new Script(loadScript("bloom-filter-ensure-exists.lua", scriptBaseUrl)),
  bloomFilterAdd: new Script(loadScript("bloom-filter-add.lua", scriptBaseUrl)),
  bloomFilterExists: new Script(loadScript("bloom-filter-exists.lua", scriptBaseUrl)),
  bloomFilterMexists: new Script(loadScript("bloom-filter-mexists.lua", scriptBaseUrl)),
  bloomFilterExistsIfReady: new Script(
    loadScript("bloom-filter-exists-if-ready.lua", scriptBaseUrl),
  ),
  bloomFilterMexistsIfReady: new Script(
    loadScript("bloom-filter-mexists-if-ready.lua", scriptBaseUrl),
  ),
  dynamicConfigSetFields: new Script(loadScript("dynamic-config-set-fields.lua", scriptBaseUrl)),
  idempotencyKeyReserve: new Script(loadScript("idempotency-key-reserve.lua", scriptBaseUrl)),
  idempotencyKeyCompleteIfCurrent: new Script(
    loadScript("idempotency-key-complete-if-current.lua", scriptBaseUrl),
  ),
  idempotencyKeyReleaseIfCurrent: new Script(
    loadScript("idempotency-key-release-if-current.lua", scriptBaseUrl),
  ),
  rateLimiterAdd: new Script(loadScript("rate-limiter-add.lua", scriptBaseUrl)),
  rateLimiterGet: new Script(loadScript("rate-limiter-get.lua", scriptBaseUrl)),
  rateLimiterAddAndCheck: new Script(loadScript("rate-limiter-add-and-check.lua", scriptBaseUrl)),
  rateLimiterAddAndCheckWindows: new Script(
    loadScript("rate-limiter-add-and-check-windows.lua", scriptBaseUrl),
  ),
} as const;

afterAll(() => {
  for (const script of Object.values(scriptRegistry)) script.release();
});

describe("lua scripts", () => {
  it("sets cache values only when invalidation markers are absent", async () => {
    const id = uniqueId("cache-set");
    const cacheKeys = [`lua:${id}:a`, `lua:${id}:b`];
    const invalidationKeys = [`lua:${id}:a:invalidated`, `lua:${id}:b:invalidated`];
    try {
      await cacheValkeyClient.set(invalidationKeys[1]!, "1");

      const result = await cacheValkeyClient.invokeScript(scriptRegistry.cacheSetIfNotInvalidated, {
        keys: [...cacheKeys, ...invalidationKeys],
        args: ["2", "30", "value-a", "30", "value-b"],
      });

      expect(result).toEqual([1, 0]);
      expect(await cacheValkeyClient.get(cacheKeys[0]!)).toEqual("value-a");
      expect(await cacheValkeyClient.get(cacheKeys[1]!)).toBeNull();
      await expectPositiveTtlSeconds(cacheKeys[0]!, 30);
    } finally {
      await unlink(cacheKeys, invalidationKeys);
    }
  });

  it("deletes cache keys and writes invalidation markers", async () => {
    const id = uniqueId("cache-delete");
    const cacheKeys = [`lua:${id}:a`, `lua:${id}:b`];
    const invalidationKeys = [`lua:${id}:a:invalidated`, `lua:${id}:b:invalidated`];
    try {
      await cacheValkeyClient.set(cacheKeys[0]!, "value-a");
      await cacheValkeyClient.set(cacheKeys[1]!, "value-b");

      const result = await cacheValkeyClient.invokeScript(
        scriptRegistry.cacheDeleteWithInvalidation,
        {
          keys: [...cacheKeys, ...invalidationKeys],
          args: ["2", "30"],
        },
      );

      expect(Number(result)).toBe(2);
      expect(await cacheValkeyClient.get(cacheKeys[0]!)).toBeNull();
      expect(await cacheValkeyClient.get(cacheKeys[1]!)).toBeNull();
      expect(await cacheValkeyClient.get(invalidationKeys[0]!)).toEqual("1");
      expect(await cacheValkeyClient.get(invalidationKeys[1]!)).toEqual("1");
      await expectPositiveTtlSeconds(invalidationKeys[0]!, 30);
      await expectPositiveTtlSeconds(invalidationKeys[1]!, 30);
    } finally {
      await unlink(cacheKeys, invalidationKeys);
    }
  });

  it("returns cache values with TTLs and bloom miss markers", async () => {
    const id = uniqueId("cache-get");
    const hitKey = `cache:lua:{${id}-hit}`;
    const missKey = `cache:lua:{${id}-miss}`;
    const bloomKey = `lua:${id}:bf`;
    try {
      await cacheValkeyClient.set(hitKey, "hit-value");
      await cacheValkeyClient.customCommand(["EXPIRE", hitKey, "30"]);
      await cacheValkeyClient.customCommand(["BF.RESERVE", bloomKey, "0.01", "100"]);
      await cacheValkeyClient.customCommand(["BF.ADD", bloomKey, `${id}-hit`]);

      const hit = await cacheValkeyClient.invokeScript(scriptRegistry.getValueWithTtl, {
        keys: [hitKey],
        args: [bloomKey],
      });
      const miss = await cacheValkeyClient.invokeScript(scriptRegistry.getValueWithTtl, {
        keys: [missKey],
        args: [bloomKey],
      });
      const batch = await cacheValkeyClient.invokeScript(scriptRegistry.getValuesWithTtl, {
        keys: [hitKey, missKey],
        args: [bloomKey],
      });

      const hitResult = expectArrayResult(hit);
      expect(hitResult).toHaveLength(3);
      expect(hitResult[0]).toEqual("hit-value");
      expectPositiveTtlMilliseconds(hitResult[1], 30_000);
      expect(hitResult[2]).toBe(0);
      expect(miss).toEqual([null, -2, 1]);
      const batchResult = expectArrayResult(batch);
      expect(batchResult).toHaveLength(6);
      expect(batchResult[0]).toEqual("hit-value");
      expectPositiveTtlMilliseconds(batchResult[1], 30_000);
      expect(batchResult.slice(2)).toEqual([0, null, -2, 1]);
    } finally {
      await unlink([hitKey, missKey, bloomKey]);
    }
  });

  it("covers bloom filter scripts and ready-marker variants", async () => {
    const id = uniqueId("bloom");
    const liveKey = `lua:${id}:live`;
    const buildingKey = `lua:${id}:building`;
    const readyKey = `lua:${id}:ready`;
    try {
      expect(
        await cacheValkeyClient.invokeScript(scriptRegistry.bloomFilterEnsureExists, {
          keys: [liveKey],
          args: ["0.01", "100", "2"],
        }),
      ).toBe(1);
      expect(
        await cacheValkeyClient.invokeScript(scriptRegistry.bloomFilterEnsureExists, {
          keys: [liveKey],
          args: ["0.01", "100", "2"],
        }),
      ).toBe(0);
      expect(
        await cacheValkeyClient.invokeScript(scriptRegistry.bloomFilterReserve, {
          keys: [buildingKey],
          args: ["0.01", "100", "2"],
        }),
      ).toEqual("OK");

      expect(
        await cacheValkeyClient.invokeScript(scriptRegistry.bloomFilterAdd, {
          keys: [liveKey, buildingKey],
          args: ["one", "two"],
        }),
      ).toBe(1);
      expect(
        await cacheValkeyClient.invokeScript(scriptRegistry.bloomFilterExists, {
          keys: [liveKey],
          args: ["one"],
        }),
      ).toBe(1);
      expect(
        await cacheValkeyClient.invokeScript(scriptRegistry.bloomFilterMexists, {
          keys: [liveKey],
          args: ["one", "missing"],
        }),
      ).toEqual([1, 0]);

      expect(
        await cacheValkeyClient.invokeScript(scriptRegistry.bloomFilterExistsIfReady, {
          keys: [readyKey, liveKey],
          args: ["one"],
        }),
      ).toBe(-1);
      await cacheValkeyClient.set(readyKey, "1");
      expect(
        await cacheValkeyClient.invokeScript(scriptRegistry.bloomFilterExistsIfReady, {
          keys: [readyKey, liveKey],
          args: ["one"],
        }),
      ).toBe(1);
      expect(
        await cacheValkeyClient.invokeScript(scriptRegistry.bloomFilterMexistsIfReady, {
          keys: [readyKey, liveKey],
          args: ["one", "missing"],
        }),
      ).toEqual([1, 0]);
    } finally {
      await unlink([liveKey, buildingKey, readyKey]);
    }
  });

  it("writes dynamic config fields with one script call", async () => {
    const key = `lua:${uniqueId("dynamic-config")}`;
    try {
      const result = await cacheValkeyClient.invokeScript(scriptRegistry.dynamicConfigSetFields, {
        keys: [key],
        args: ["enabled", "true", "count", "2"],
      });

      expect(result).toBe(1);
      expect(toFieldMap(await cacheValkeyClient.hgetall(key))).toEqual(
        new Map([
          ["enabled", "true"],
          ["count", "2"],
        ]),
      );
    } finally {
      await unlink([key]);
    }
  });

  it("covers idempotency key scripts", async () => {
    const key = `idempotency-lua:{${uniqueId("idempotency")}}`;
    try {
      expect(
        await cacheValkeyClient.invokeScript(scriptRegistry.idempotencyKeyReserve, {
          keys: [key],
          args: ["30", "processing", "completed", "token-1"],
        }),
      ).toBe("reserved");
      expect(
        await cacheValkeyClient.invokeScript(scriptRegistry.idempotencyKeyReserve, {
          keys: [key],
          args: ["30", "processing", "completed", "token-2"],
        }),
      ).toBe("processing");
      expect(
        await cacheValkeyClient.invokeScript(scriptRegistry.idempotencyKeyCompleteIfCurrent, {
          keys: [key],
          args: ["30", "processing:wrong", "completed"],
        }),
      ).toBe("changed");
      expect(
        await cacheValkeyClient.invokeScript(scriptRegistry.idempotencyKeyCompleteIfCurrent, {
          keys: [key],
          args: ["30", "processing:token-1", "completed"],
        }),
      ).toBe("completed");
      expect(
        await cacheValkeyClient.invokeScript(scriptRegistry.idempotencyKeyReserve, {
          keys: [key],
          args: ["30", "processing", "completed", "token-3"],
        }),
      ).toBe("completed");
      expect(
        await cacheValkeyClient.invokeScript(scriptRegistry.idempotencyKeyReleaseIfCurrent, {
          keys: [key],
          args: ["processing:token-1"],
        }),
      ).toBe(0);
    } finally {
      await unlink([key]);
    }

    const releasedKey = `idempotency-lua:{${uniqueId("release")}}`;
    try {
      await cacheValkeyClient.invokeScript(scriptRegistry.idempotencyKeyReserve, {
        keys: [releasedKey],
        args: ["30", "processing", "completed", "token-1"],
      });
      expect(
        await cacheValkeyClient.invokeScript(scriptRegistry.idempotencyKeyReleaseIfCurrent, {
          keys: [releasedKey],
          args: ["processing:token-1"],
        }),
      ).toBe(1);
      expect(
        await cacheValkeyClient.invokeScript(scriptRegistry.idempotencyKeyCompleteIfCurrent, {
          keys: [releasedKey],
          args: ["30", "processing:token-1", "completed"],
        }),
      ).toBe("missing");
    } finally {
      await unlink([releasedKey]);
    }
  });

  it("adds and counts rate limiter entries with server-time scripts", async () => {
    const id = uniqueId("rate");
    const keys = [`rate-limiter:lua:{${id}:a}`, `rate-limiter:lua:{${id}:b}`];
    try {
      expect(
        await rateLimiterValkeyClient.invokeScript(scriptRegistry.rateLimiterAdd, {
          keys,
          args: ["30", "a-1", "b-1"],
        }),
      ).toBe(1);
      expect(
        await rateLimiterValkeyClient.invokeScript(scriptRegistry.rateLimiterGet, {
          keys,
          args: ["30"],
        }),
      ).toEqual([1, 1]);
      expect(
        await rateLimiterValkeyClient.invokeScript(scriptRegistry.rateLimiterAddAndCheck, {
          keys,
          args: ["30", "a-2", "b-2"],
        }),
      ).toEqual([2, 2]);
      expect(
        await rateLimiterValkeyClient.invokeScript(scriptRegistry.rateLimiterAddAndCheckWindows, {
          keys,
          args: ["record-all", "30", "3", "a-3", "30", "3", "b-3"],
        }),
      ).toEqual([3, 3, 1]);
    } finally {
      await rateLimiterValkeyClient.unlink(keys);
    }
  });
});

function uniqueId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2)}`;
}

async function unlink(...groups: string[][]): Promise<void> {
  const keys = groups.flat();
  if (keys.length === 0) return;
  await cacheValkeyClient.unlink(keys);
}

function toFieldMap(fields: unknown): Map<string, string> {
  if (fields instanceof Map)
    return new Map([...fields].map(([key, value]) => [String(key), String(value)]));
  if (fields && typeof fields === "object" && !Array.isArray(fields)) {
    return new Map(Object.entries(fields).map(([key, value]) => [key, String(value)]));
  }
  const fieldMap = new Map<string, string>();
  if (!Array.isArray(fields)) return fieldMap;
  for (const field of fields) {
    if (field && typeof field === "object" && "field" in field && "value" in field) {
      fieldMap.set(String(field.field), String(field.value));
    }
  }
  return fieldMap;
}

async function expectPositiveTtlSeconds(key: string, maxSeconds: number): Promise<void> {
  const ttl = Number(await cacheValkeyClient.ttl(key));
  expect(ttl).toBeGreaterThan(0);
  expect(ttl).toBeLessThanOrEqual(maxSeconds);
}

function expectPositiveTtlMilliseconds(value: unknown, maxMilliseconds: number): void {
  const ttl = Number(value);
  expect(ttl).toBeGreaterThan(0);
  expect(ttl).toBeLessThanOrEqual(maxMilliseconds);
}

function expectArrayResult(value: unknown): unknown[] {
  expect(Array.isArray(value)).toBe(true);
  if (!Array.isArray(value)) throw new Error("expected script result to be an array");
  return value;
}
