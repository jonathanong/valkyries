import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { Batch, GlideClient } from "@valkey/valkey-glide";
import { cacheValkeyClient } from "../clients.mts";
import { expireKeysWithNoExpiry } from "../expiry.mts";

const keysToClean = new Set<string>();

afterEach(async () => {
  if (keysToClean.size === 0) return;
  await cacheValkeyClient.unlink([...keysToClean]);
  keysToClean.clear();
});

describe("expireKeysWithNoExpiry integration", () => {
  it("sets a TTL on keys without one while preserving existing TTLs", async () => {
    const prefix = `expiry-integration:${randomUUID()}`;
    const noExpiryKey = `${prefix}:no-expiry`;
    const existingExpiryKey = `${prefix}:existing-expiry`;
    keysToClean.add(noExpiryKey);
    keysToClean.add(existingExpiryKey);
    await cacheValkeyClient.set(noExpiryKey, "value");
    await cacheValkeyClient.set(existingExpiryKey, "value");
    await cacheValkeyClient.expire(existingExpiryKey, 120);

    await expect(
      expireKeysWithNoExpiry(cacheValkeyClient, { pattern: `${prefix}:*`, ttl: 60 }),
    ).resolves.toEqual({ scannedKeys: 2, matchedKeys: 2, expiredKeys: 1 });
    await expect(cacheValkeyClient.ttl(noExpiryKey)).resolves.toBeGreaterThan(0);
    await expect(cacheValkeyClient.ttl(existingExpiryKey)).resolves.toBeGreaterThan(60);
  });

  it("does not overwrite a TTL added between SCAN and EXPIRE NX", async () => {
    const prefix = `expiry-integration:${randomUUID()}`;
    const key = `${prefix}:race`;
    keysToClean.add(key);
    await cacheValkeyClient.set(key, "value");
    let addExpiryBeforeExec = true;
    const client = {
      scan: cacheValkeyClient.scan.bind(cacheValkeyClient),
      exec: async (batch: Batch, raiseOnError: boolean) => {
        if (addExpiryBeforeExec) {
          addExpiryBeforeExec = false;
          await cacheValkeyClient.expire(key, 120);
        }
        return await cacheValkeyClient.exec(batch, raiseOnError);
      },
    } as unknown as GlideClient;

    await expect(
      expireKeysWithNoExpiry(client, { pattern: `${prefix}:*`, ttl: 60 }),
    ).resolves.toEqual({
      scannedKeys: 1,
      matchedKeys: 1,
      expiredKeys: 0,
    });
    await expect(cacheValkeyClient.ttl(key)).resolves.toBeGreaterThan(60);
  });
});
