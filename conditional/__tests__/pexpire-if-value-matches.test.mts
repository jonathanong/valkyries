import { describe, expect, it, vi } from "vitest";
import { cacheValkeyClient } from "../../clients.mts";
import { pexpireIfValueMatches } from "../../conditional.mts";
import type { GlideClient } from "@valkey/valkey-glide";

const key = () => `conditional-pexpire:{${process.pid}-${Math.random().toString(36).slice(2)}}`;
const pttl = async (k: string) => (await cacheValkeyClient.customCommand(["PTTL", k])) as number;

describe("pexpireIfValueMatches", () => {
  it("sets the TTL only when the stored value matches", async () => {
    const k = key();
    try {
      await cacheValkeyClient.set(k, "current");

      await expect(pexpireIfValueMatches(k, "other", 50_000)).resolves.toBe(false);
      expect(await pttl(k)).toBe(-1);
      await expect(pexpireIfValueMatches(k, "current", 50_000)).resolves.toBe(true);
      expect(await pttl(k)).toBeGreaterThan(0);
      await cacheValkeyClient.unlink([k]);
      await expect(pexpireIfValueMatches(k, "current", 50_000)).resolves.toBe(false);
      await expect(cacheValkeyClient.get(k)).resolves.toBeNull();
    } finally {
      await cacheValkeyClient.unlink([k]);
    }
  });

  it("uses the provided client and validates inputs and results", async () => {
    const invokeScript = vi.fn<GlideClient["invokeScript"]>().mockResolvedValue(1n);
    const client = { invokeScript } as unknown as GlideClient;

    await expect(pexpireIfValueMatches("key", "value", 10, { client })).resolves.toBe(true);
    expect(invokeScript).toHaveBeenCalledWith(expect.anything(), {
      keys: ["key"],
      args: ["value", "10"],
    });
    invokeScript.mockResolvedValue(0n);
    await expect(pexpireIfValueMatches("key", "value", 10, { client })).resolves.toBe(false);

    await expect(pexpireIfValueMatches("", "v", 10, { client })).rejects.toThrow(
      "key must not be empty",
    );
    await expect(pexpireIfValueMatches("key", "v", 0, { client })).rejects.toThrow("ttlMs");
    await expect(pexpireIfValueMatches("key", "v", 1.5, { client })).rejects.toThrow("ttlMs");
    invokeScript.mockResolvedValue("odd");
    await expect(pexpireIfValueMatches("key", "v", 10, { client })).rejects.toThrow(
      "Unexpected conditional pexpire result: odd",
    );
  });
});
