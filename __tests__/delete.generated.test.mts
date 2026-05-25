import { deleteKeysWithPrefix } from "../delete.mts";
import { cacheValkeyClient } from "../clients.mts";
import { it, expect, describe, vi } from "vitest";
import type { GlideClient } from "@valkey/valkey-glide";
import * as errors from "../errors.mts";

describe("delete.generated", () => {
  it("deleteKeysWithPrefix", async () => {
    const prefix = `test-delete-${Math.random().toString(36).slice(2)}`;
    const key1 = `${prefix}:key1`;
    const key2 = `${prefix}:key2`;
    const key3 = `${prefix}:nested:key3`;
    const otherKey = "other-prefix:key";

    // Set some test keys
    await cacheValkeyClient.set(key1, "value1");
    await cacheValkeyClient.set(key2, "value2");
    await cacheValkeyClient.set(key3, "value3");
    await cacheValkeyClient.set(otherKey, "other-value");

    // Verify keys exist
    expect(await cacheValkeyClient.get(key1)).toBe("value1");
    expect(await cacheValkeyClient.get(key2)).toBe("value2");
    expect(await cacheValkeyClient.get(key3)).toBe("value3");
    expect(await cacheValkeyClient.get(otherKey)).toBe("other-value");

    // Delete keys with prefix pattern
    await deleteKeysWithPrefix(cacheValkeyClient, `${prefix}:*`);

    // Verify prefix keys are deleted
    expect(await cacheValkeyClient.get(key1)).toBeNull();
    expect(await cacheValkeyClient.get(key2)).toBeNull();
    expect(await cacheValkeyClient.get(key3)).toBeNull();

    // Verify other key still exists
    expect(await cacheValkeyClient.get(otherKey)).toBe("other-value");

    // Clean up
    await cacheValkeyClient.unlink([otherKey]);
  }, 15_000);

  it("deleteKeysWithPrefix with empty pattern", async () => {
    const prefix = `test-empty-${Math.random().toString(36).slice(2)}`;
    const key = `${prefix}:key`;

    await cacheValkeyClient.set(key, "value");
    expect(await cacheValkeyClient.get(key)).toBe("value");

    // Delete with pattern that matches nothing
    await deleteKeysWithPrefix(
      cacheValkeyClient,
      `nonexistent-prefix-${Math.random().toString(36)}:*`,
    );

    // Original key should still exist
    expect(await cacheValkeyClient.get(key)).toBe("value");

    // Clean up
    await cacheValkeyClient.unlink([key]);
  }, 15_000);

  it("deleteKeysWithPrefix deletes many keys by prefix", async () => {
    const prefix = `test-multi-${Math.random().toString(36).slice(2)}`;
    const count = 50;
    const keys = Array.from({ length: count }, (_, i) => `${prefix}:key-${i}`);

    await Promise.all(keys.map((k) => cacheValkeyClient.set(k, "v")));

    await deleteKeysWithPrefix(cacheValkeyClient, `${prefix}:*`);

    // All keys should be gone
    const values = await Promise.all(keys.map((k) => cacheValkeyClient.get(k)));
    expect(values.every((v) => v === null)).toBe(true);
  }, 15_000);

  it("deleteKeysWithPrefix proceeds while unlink promises are in-flight", async () => {
    let resolveFirstUnlink: () => void = () => {};
    const firstUnlink = new Promise<number>((resolve) => {
      resolveFirstUnlink = () => resolve(1);
    });
    const scan = vi
      .fn()
      .mockResolvedValueOnce(["1", ["prefix:a"]])
      .mockResolvedValueOnce(["0", ["prefix:b"]]);
    const unlink = vi
      .fn()
      .mockResolvedValueOnce(firstUnlink)
      .mockResolvedValueOnce(1);
    const client = { scan, unlink } as unknown as GlideClient;

    const deletePromise = deleteKeysWithPrefix(client, "prefix:*");
    await Promise.resolve();

    expect(scan).toHaveBeenCalledTimes(2);
    expect(unlink).toHaveBeenCalledTimes(1);

    resolveFirstUnlink();
    await deletePromise;

    expect(scan).toHaveBeenCalledTimes(2);
    expect(unlink).toHaveBeenCalledTimes(2);
  });

  it("deleteKeysWithPrefix handles Valkey errors", async () => {
    const error = new Error("test error");
    const scan = vi.fn().mockRejectedValueOnce(error);
    const client = { scan } as unknown as GlideClient;

    const spy = vi.spyOn(errors, "handleValkeyError").mockImplementation(() => {});

    try {
      await expect(deleteKeysWithPrefix(client, "prefix:*")).rejects.toThrow("test error");
      expect(spy).toHaveBeenCalledWith(error);
    } finally {
      spy.mockRestore();
    }
  });

  it("deleteKeysWithPrefix handles Valkey unlink errors", async () => {
    const error = new Error("test error");
    const scan = vi.fn().mockResolvedValueOnce(["0", ["prefix:a"]]);
    const unlink = vi.fn().mockRejectedValueOnce(error);
    const client = { scan, unlink } as unknown as GlideClient;

    const spy = vi.spyOn(errors, "handleValkeyError").mockImplementation(() => {});

    try {
      await expect(deleteKeysWithPrefix(client, "prefix:*")).rejects.toThrow("test error");
      expect(spy).toHaveBeenCalledWith(error);
    } finally {
      spy.mockRestore();
    }

    expect(scan).toHaveBeenCalledTimes(1);
    expect(unlink).toHaveBeenCalledTimes(1);
  });
});
