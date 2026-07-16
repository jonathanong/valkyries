import { describe, expect, it, vi } from "vitest";
import { cacheValkeyClient } from "../../clients.mts";
import { unlinkIfValueMatches } from "../../conditional.mts";
import type { GlideClient } from "@valkey/valkey-glide";

let unique = 0;
const rand = () => {
  unique += 1;
  return unique.toString(36);
};

describe("conditional", () => {
  it("unlinks only when the stored value matches", async () => {
    const key = `conditional-unlink:{${rand()}}`;
    try {
      await cacheValkeyClient.set(key, "current");

      await expect(unlinkIfValueMatches(key, "changed")).resolves.toBe(false);
      await expect(cacheValkeyClient.get(key)).resolves.toBe("current");
      await expect(unlinkIfValueMatches(key, "current")).resolves.toBe(true);
      await expect(unlinkIfValueMatches(key, "current")).resolves.toBe(false);
    } finally {
      await cacheValkeyClient.unlink([key]);
    }
  });

  it("supports matching an empty stored value", async () => {
    const key = `conditional-unlink-empty:{${rand()}}`;
    try {
      await cacheValkeyClient.set(key, "");

      await expect(unlinkIfValueMatches(key, "")).resolves.toBe(true);
    } finally {
      await cacheValkeyClient.unlink([key]);
    }
  });

  it("uses the provided client", async () => {
    const invokeScript = vi.fn<GlideClient["invokeScript"]>().mockResolvedValue(1);
    const client = { invokeScript } as unknown as GlideClient;

    await expect(unlinkIfValueMatches("key", "value", { client })).resolves.toBe(true);

    expect(invokeScript).toHaveBeenCalledWith(expect.anything(), {
      keys: ["key"],
      args: ["value"],
    });
  });

  it("validates keys and rejects unexpected script results", async () => {
    const invokeScript = vi.fn<GlideClient["invokeScript"]>().mockResolvedValue("unexpected");
    const client = { invokeScript } as unknown as GlideClient;

    await expect(unlinkIfValueMatches("", "value", { client })).rejects.toThrow(
      "key must not be empty",
    );
    expect(invokeScript).not.toHaveBeenCalled();
    await expect(unlinkIfValueMatches("key", "value", { client })).rejects.toThrow(
      "Unexpected conditional unlink result: unexpected",
    );
  });
});
