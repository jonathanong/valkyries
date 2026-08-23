import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlideClient } from "@valkey/valkey-glide";
import {
  deleteKeysWithLiteralPrefixes,
  deleteKeysWithPrefix,
  scanAndUnlinkKeys,
} from "../delete.mts";

const { mockHandleValkeyError } = vi.hoisted(() => ({
  mockHandleValkeyError: vi.fn(),
}));

vi.mock("../errors.mts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../errors.mts")>();
  return {
    ...actual,
    handleValkeyError: mockHandleValkeyError,
  };
});

describe("deleteKeysWithPrefix", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should match keys by prefix and delete them", async () => {
    const scanMock = vi.fn().mockResolvedValueOnce(["0", ["prefix:key1", "prefix:key2"]]);
    const unlinkMock = vi.fn().mockResolvedValueOnce(2);

    const client = {
      scan: scanMock,
      unlink: unlinkMock,
    } as unknown as GlideClient;

    await deleteKeysWithPrefix(client, "prefix:*");

    expect(scanMock).toHaveBeenCalledTimes(1);
    expect(scanMock).toHaveBeenCalledWith("0", { match: "prefix:*", count: 500 });
    expect(unlinkMock).toHaveBeenCalledTimes(1);
    expect(unlinkMock).toHaveBeenCalledWith(["prefix:key1", "prefix:key2"]);
  });

  it("should do nothing when no keys match the pattern", async () => {
    const scanMock = vi.fn().mockResolvedValueOnce(["0", []]);
    const unlinkMock = vi.fn();

    const client = {
      scan: scanMock,
      unlink: unlinkMock,
    } as unknown as GlideClient;

    await deleteKeysWithPrefix(client, "nonexistent:*");

    expect(scanMock).toHaveBeenCalledTimes(1);
    expect(scanMock).toHaveBeenCalledWith("0", { match: "nonexistent:*", count: 500 });
    expect(unlinkMock).not.toHaveBeenCalled();
  });

  it("should handle scan pagination (cursor iteration)", async () => {
    const scanMock = vi
      .fn()
      .mockResolvedValueOnce(["10", ["prefix:a", "prefix:b"]])
      .mockResolvedValueOnce(["20", []])
      .mockResolvedValueOnce(["0", ["prefix:c"]]);

    const unlinkMock = vi.fn().mockResolvedValue(1);

    const client = {
      scan: scanMock,
      unlink: unlinkMock,
    } as unknown as GlideClient;

    await deleteKeysWithPrefix(client, "prefix:*");

    expect(scanMock).toHaveBeenCalledTimes(3);
    expect(scanMock).toHaveBeenNthCalledWith(1, "0", { match: "prefix:*", count: 500 });
    expect(scanMock).toHaveBeenNthCalledWith(2, "10", { match: "prefix:*", count: 500 });
    expect(scanMock).toHaveBeenNthCalledWith(3, "20", { match: "prefix:*", count: 500 });

    expect(unlinkMock).toHaveBeenCalledTimes(2);
    expect(unlinkMock).toHaveBeenNthCalledWith(1, ["prefix:a", "prefix:b"]);
    expect(unlinkMock).toHaveBeenNthCalledWith(2, ["prefix:c"]);
  });

  it("should handle error from scan and propagate it after calling handleValkeyError", async () => {
    const mockError = new Error("Scan failed");
    const scanMock = vi.fn().mockRejectedValueOnce(mockError);
    const client = { scan: scanMock } as unknown as GlideClient;

    await expect(deleteKeysWithPrefix(client, "prefix:*")).rejects.toThrow("Scan failed");
    expect(mockHandleValkeyError).toHaveBeenCalledWith(mockError);
  });

  it("should handle error from unlink and propagate it after calling handleValkeyError", async () => {
    const scanMock = vi.fn().mockResolvedValueOnce(["0", ["prefix:1"]]);
    const mockError = new Error("Unlink failed");
    const unlinkMock = vi.fn().mockRejectedValueOnce(mockError);

    const client = {
      scan: scanMock,
      unlink: unlinkMock,
    } as unknown as GlideClient;

    await expect(deleteKeysWithPrefix(client, "prefix:*")).rejects.toThrow("Unlink failed");
    expect(scanMock).toHaveBeenCalledTimes(1);
    expect(unlinkMock).toHaveBeenCalledTimes(1);
    expect(mockHandleValkeyError).toHaveBeenCalledWith(mockError);
  });

  it("deletes only keys with the supplied literal prefixes", async () => {
    const scanMock = vi
      .fn()
      .mockResolvedValueOnce(["0", ["cache:users:1", "cache:topics:1", "cache:other:1"]]);
    const unlinkMock = vi.fn().mockResolvedValueOnce(2);
    const client = { scan: scanMock, unlink: unlinkMock } as unknown as GlideClient;

    const prefixes = ["cache:users:", null, "cache:topics:", undefined] as unknown as string[];
    await deleteKeysWithLiteralPrefixes(client, "cache:*", prefixes);

    expect(scanMock).toHaveBeenCalledWith("0", { match: "cache:*", count: 500 });
    expect(unlinkMock).toHaveBeenCalledWith(["cache:users:1", "cache:topics:1"]);
  });

  it("awaits unlink before scanning the next cursor page", async () => {
    const scanCalls: string[] = [];
    let resolveUnlink: () => void;
    const blockUnlink = new Promise<void>((resolve) => {
      resolveUnlink = resolve;
    });

    const scanMock = vi.fn(async (cursor: string) => {
      scanCalls.push(`scan:${cursor}`);
      if (cursor === "0") {
        return ["10", ["prefix:1"]];
      }
      return ["0", []];
    });

    const unlinkMock = vi.fn().mockImplementation(async () => {
      scanCalls.push("unlink");
      await blockUnlink;
      return 1;
    });

    const client = {
      scan: scanMock,
      unlink: unlinkMock,
    } as unknown as GlideClient;

    const result = deleteKeysWithPrefix(client, "prefix:*");

    await vi.waitFor(() => expect(unlinkMock).toHaveBeenCalledOnce());
    expect(scanCalls).toEqual(["scan:0", "unlink"]);
    resolveUnlink!();
    await result;

    expect(scanCalls).toEqual(["scan:0", "unlink", "scan:10"]);
    expect(unlinkMock).toHaveBeenCalledTimes(1);
    expect(scanMock).toHaveBeenCalledTimes(2);
  });
});

describe("scanAndUnlinkKeys", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("scans every page and returns scanned, matched, and confirmed unlink counts", async () => {
    const scanMock = vi
      .fn()
      .mockResolvedValueOnce(["10", ["prefix:a", "prefix:b"]])
      .mockResolvedValueOnce(["0", ["prefix:c"]]);
    const unlinkMock = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    const client = { scan: scanMock, unlink: unlinkMock } as unknown as GlideClient;

    await expect(scanAndUnlinkKeys(client, "prefix:*")).resolves.toEqual({
      scannedKeys: 3,
      matchedKeys: 3,
      unlinkedKeys: 2,
    });
    expect(scanMock).toHaveBeenNthCalledWith(1, "0", { match: "prefix:*", count: 500 });
    expect(scanMock).toHaveBeenNthCalledWith(2, "10", { match: "prefix:*", count: 500 });
    expect(unlinkMock).toHaveBeenNthCalledWith(1, ["prefix:a", "prefix:b"]);
    expect(unlinkMock).toHaveBeenNthCalledWith(2, ["prefix:c"]);
  });

  it("filters keys with the predicate while preserving Buffer GlideString keys", async () => {
    const binaryKey = Buffer.from("prefix:binary");
    const scanMock = vi.fn().mockResolvedValueOnce(["0", [binaryKey, "prefix:keep", "other:skip"]]);
    const unlinkMock = vi.fn().mockResolvedValueOnce(2);
    const client = { scan: scanMock, unlink: unlinkMock } as unknown as GlideClient;

    await expect(
      scanAndUnlinkKeys(client, "*", {
        matches: (key) => Buffer.from(key).toString("utf8").startsWith("prefix:"),
      }),
    ).resolves.toEqual({ scannedKeys: 3, matchedKeys: 2, unlinkedKeys: 2 });
    expect(unlinkMock).toHaveBeenCalledWith([binaryKey, "prefix:keep"]);
  });

  it("does not scan when the signal is already aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("stop before scan");
    controller.abort(reason);
    const scanMock = vi.fn();
    const client = { scan: scanMock } as unknown as GlideClient;

    await expect(scanAndUnlinkKeys(client, "prefix:*", { signal: controller.signal })).rejects.toBe(
      reason,
    );
    expect(scanMock).not.toHaveBeenCalled();
    expect(mockHandleValkeyError).not.toHaveBeenCalled();
  });

  it("stops between scan and unlink when the signal aborts", async () => {
    const controller = new AbortController();
    const reason = new Error("stop before unlink");
    const scanMock = vi.fn().mockResolvedValueOnce(["0", ["prefix:key"]]);
    const unlinkMock = vi.fn();
    const client = { scan: scanMock, unlink: unlinkMock } as unknown as GlideClient;

    await expect(
      scanAndUnlinkKeys(client, "prefix:*", {
        signal: controller.signal,
        matches: () => {
          controller.abort(reason);
          return true;
        },
      }),
    ).rejects.toBe(reason);
    expect(unlinkMock).not.toHaveBeenCalled();
    expect(mockHandleValkeyError).not.toHaveBeenCalled();
  });

  it("stops after a pending scan resolves when the signal aborts", async () => {
    const controller = new AbortController();
    const reason = new Error("stop after pending scan");
    let resolveScan: (result: [string, string[]]) => void;
    const pendingScan = new Promise<[string, string[]]>((resolve) => {
      resolveScan = resolve;
    });
    const scanMock = vi.fn().mockReturnValueOnce(pendingScan);
    const matches = vi.fn(() => true);
    const unlinkMock = vi.fn();
    const client = { scan: scanMock, unlink: unlinkMock } as unknown as GlideClient;

    const result = scanAndUnlinkKeys(client, "prefix:*", { signal: controller.signal, matches });
    await vi.waitFor(() => expect(scanMock).toHaveBeenCalledOnce());
    controller.abort(reason);
    resolveScan!(["0", ["prefix:key"]]);

    await expect(result).rejects.toBe(reason);
    expect(matches).not.toHaveBeenCalled();
    expect(unlinkMock).not.toHaveBeenCalled();
    expect(mockHandleValkeyError).not.toHaveBeenCalled();
  });

  it("stops after unlink when the signal aborts", async () => {
    const controller = new AbortController();
    const reason = new Error("stop after unlink");
    const scanMock = vi.fn().mockResolvedValueOnce(["0", ["prefix:key"]]);
    const unlinkMock = vi.fn(() => {
      controller.abort(reason);
      return Promise.resolve(1);
    });
    const client = { scan: scanMock, unlink: unlinkMock } as unknown as GlideClient;

    await expect(scanAndUnlinkKeys(client, "prefix:*", { signal: controller.signal })).rejects.toBe(
      reason,
    );
    expect(unlinkMock).toHaveBeenCalledWith(["prefix:key"]);
    expect(mockHandleValkeyError).not.toHaveBeenCalled();
  });

  it("reports scan errors through handleValkeyError", async () => {
    const error = new Error("Scan failed");
    const scanMock = vi.fn().mockRejectedValueOnce(error);
    const client = { scan: scanMock } as unknown as GlideClient;

    await expect(scanAndUnlinkKeys(client, "prefix:*")).rejects.toBe(error);
    expect(mockHandleValkeyError).toHaveBeenCalledWith(error);
  });

  it("reports unlink errors through handleValkeyError", async () => {
    const error = new Error("Unlink failed");
    const scanMock = vi.fn().mockResolvedValueOnce(["0", ["prefix:key"]]);
    const unlinkMock = vi.fn().mockRejectedValueOnce(error);
    const client = { scan: scanMock, unlink: unlinkMock } as unknown as GlideClient;

    await expect(scanAndUnlinkKeys(client, "prefix:*")).rejects.toBe(error);
    expect(mockHandleValkeyError).toHaveBeenCalledWith(error);
  });
});
