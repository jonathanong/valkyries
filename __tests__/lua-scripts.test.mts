import { Script } from "@valkey/valkey-glide";
import { afterAll, describe, expect, it } from "vitest";
import { cacheValkeyClient, rateLimiterValkeyClient } from "../clients.mts";
import { loadScript } from "../scripts.mts";

const scriptBaseUrl = new URL("../", import.meta.url);
const scripts = [
  new Script(loadScript("cache-set-if-not-invalidated.lua", scriptBaseUrl)),
  new Script(loadScript("cache-delete-with-invalidation.lua", scriptBaseUrl)),
  new Script(loadScript("get-value-with-ttl.lua", scriptBaseUrl)),
  new Script(loadScript("get-values-with-ttl.lua", scriptBaseUrl)),
  new Script(loadScript("bloom-filter-reserve.lua", scriptBaseUrl)),
  new Script(loadScript("bloom-filter-ensure-exists.lua", scriptBaseUrl)),
  new Script(loadScript("bloom-filter-add.lua", scriptBaseUrl)),
  new Script(loadScript("bloom-filter-exists.lua", scriptBaseUrl)),
  new Script(loadScript("bloom-filter-mexists.lua", scriptBaseUrl)),
  new Script(loadScript("bloom-filter-exists-if-ready.lua", scriptBaseUrl)),
  new Script(loadScript("bloom-filter-mexists-if-ready.lua", scriptBaseUrl)),
  new Script(loadScript("dynamic-config-set-fields.lua", scriptBaseUrl)),
  new Script(loadScript("rate-limiter-add.lua", scriptBaseUrl)),
  new Script(loadScript("rate-limiter-get.lua", scriptBaseUrl)),
  new Script(loadScript("rate-limiter-add-and-check.lua", scriptBaseUrl)),
] as const;

const [
  cacheSetIfNotInvalidatedScript,
  cacheDeleteWithInvalidationScript,
  getValueWithTtlScript,
  getValuesWithTtlScript,
  bloomFilterReserveScript,
  bloomFilterEnsureExistsScript,
  bloomFilterAddScript,
  bloomFilterExistsScript,
  bloomFilterMexistsScript,
  bloomFilterExistsIfReadyScript,
  bloomFilterMexistsIfReadyScript,
  dynamicConfigSetFieldsScript,
  rateLimiterAddScript,
  rateLimiterGetScript,
  rateLimiterAddAndCheckScript,
] = scripts;

afterAll(() => {
  for (const script of scripts) script.release();
});

describe("lua scripts", () => {
  it("sets cache values only when invalidation markers are absent", async () => {
    const id = uniqueId("cache-set");
    const cacheKeys = [`lua:${id}:a`, `lua:${id}:b`];
    const invalidationKeys = [`lua:${id}:a:invalidated`, `lua:${id}:b:invalidated`];
    try {
      await cacheValkeyClient.set(invalidationKeys[1]!, "1");

      const result = await cacheValkeyClient.invokeScript(cacheSetIfNotInvalidatedScript, {
        keys: [...cacheKeys, ...invalidationKeys],
        args: ["2", "30", "value-a", "30", "value-b"],
      });

      expect(result).toEqual([1, 0]);
      expect(await cacheValkeyClient.get(cacheKeys[0]!)).toEqual("value-a");
      expect(await cacheValkeyClient.get(cacheKeys[1]!)).toBeNull();
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

      const result = await cacheValkeyClient.invokeScript(cacheDeleteWithInvalidationScript, {
        keys: [...cacheKeys, ...invalidationKeys],
        args: ["2", "30"],
      });

      expect(Number(result)).toBe(2);
      expect(await cacheValkeyClient.get(cacheKeys[0]!)).toBeNull();
      expect(await cacheValkeyClient.get(cacheKeys[1]!)).toBeNull();
      expect(await cacheValkeyClient.get(invalidationKeys[0]!)).toEqual("1");
      expect(await cacheValkeyClient.get(invalidationKeys[1]!)).toEqual("1");
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

      const hit = await cacheValkeyClient.invokeScript(getValueWithTtlScript, {
        keys: [hitKey],
        args: [bloomKey],
      });
      const miss = await cacheValkeyClient.invokeScript(getValueWithTtlScript, {
        keys: [missKey],
        args: [bloomKey],
      });
      const batch = await cacheValkeyClient.invokeScript(getValuesWithTtlScript, {
        keys: [hitKey, missKey],
        args: [bloomKey],
      });

      expect(Array.isArray(hit)).toBe(true);
      expect(hit).toEqual(["hit-value", expect.any(Number), 0]);
      expect(miss).toEqual([null, -2, 1]);
      expect(batch).toEqual(["hit-value", expect.any(Number), 0, null, -2, 1]);
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
        await cacheValkeyClient.invokeScript(bloomFilterEnsureExistsScript, {
          keys: [liveKey],
          args: ["0.01", "100", "2"],
        }),
      ).toBe(1);
      expect(
        await cacheValkeyClient.invokeScript(bloomFilterEnsureExistsScript, {
          keys: [liveKey],
          args: ["0.01", "100", "2"],
        }),
      ).toBe(0);
      expect(
        await cacheValkeyClient.invokeScript(bloomFilterReserveScript, {
          keys: [buildingKey],
          args: ["0.01", "100", "2"],
        }),
      ).toEqual("OK");

      expect(
        await cacheValkeyClient.invokeScript(bloomFilterAddScript, {
          keys: [liveKey, buildingKey],
          args: ["one", "two"],
        }),
      ).toBe(1);
      expect(
        await cacheValkeyClient.invokeScript(bloomFilterExistsScript, {
          keys: [liveKey],
          args: ["one"],
        }),
      ).toBe(1);
      expect(
        await cacheValkeyClient.invokeScript(bloomFilterMexistsScript, {
          keys: [liveKey],
          args: ["one", "missing"],
        }),
      ).toEqual([1, 0]);

      expect(
        await cacheValkeyClient.invokeScript(bloomFilterExistsIfReadyScript, {
          keys: [readyKey, liveKey],
          args: ["one"],
        }),
      ).toBe(-1);
      await cacheValkeyClient.set(readyKey, "1");
      expect(
        await cacheValkeyClient.invokeScript(bloomFilterExistsIfReadyScript, {
          keys: [readyKey, liveKey],
          args: ["one"],
        }),
      ).toBe(1);
      expect(
        await cacheValkeyClient.invokeScript(bloomFilterMexistsIfReadyScript, {
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
      const result = await cacheValkeyClient.invokeScript(dynamicConfigSetFieldsScript, {
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

  it("adds and counts rate limiter entries with server-time scripts", async () => {
    const id = uniqueId("rate");
    const keys = [`rate-limiter:lua:{${id}:a}`, `rate-limiter:lua:{${id}:b}`];
    try {
      expect(
        await rateLimiterValkeyClient.invokeScript(rateLimiterAddScript, {
          keys,
          args: ["30", "a-1", "b-1"],
        }),
      ).toBe(1);
      expect(
        await rateLimiterValkeyClient.invokeScript(rateLimiterGetScript, {
          keys,
          args: ["30"],
        }),
      ).toEqual([1, 1]);
      expect(
        await rateLimiterValkeyClient.invokeScript(rateLimiterAddAndCheckScript, {
          keys,
          args: ["30", "a-2", "b-2"],
        }),
      ).toEqual([2, 2]);
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
  const fieldMap = new Map<string, string>();
  if (!Array.isArray(fields)) return fieldMap;
  for (const field of fields) {
    if (field && typeof field === "object" && "field" in field && "value" in field) {
      fieldMap.set(String(field.field), String(field.value));
    }
  }
  return fieldMap;
}
