import { afterEach, describe, expect, it, vi } from "vitest";
import type { GlideClient } from "@valkey/valkey-glide";
import { deleteKeysWithPrefix } from "../delete.mts";

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
    expect(scanMock).toHaveBeenCalledWith("0", { match: "prefix:*" });
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
    expect(scanMock).toHaveBeenCalledWith("0", { match: "nonexistent:*" });
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
    expect(scanMock).toHaveBeenNthCalledWith(1, "0", { match: "prefix:*" });
    expect(scanMock).toHaveBeenNthCalledWith(2, "10", { match: "prefix:*" });
    expect(scanMock).toHaveBeenNthCalledWith(3, "20", { match: "prefix:*" });

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

  it("should batch and await unlink promises when count reaches 100", async () => {
    const scanMock = vi.fn(async (cursor: string) => {
      const nextCursor = (parseInt(cursor, 10) + 1).toString();
      if (cursor === "105") {
        return ["0", ["prefix:last"]];
      }
      return [nextCursor, [`prefix:${cursor}`]];
    });

    const unlinkMock = vi.fn().mockResolvedValue(1);

    const client = {
      scan: scanMock,
      unlink: unlinkMock,
    } as unknown as GlideClient;

    await deleteKeysWithPrefix(client, "prefix:*");

    expect(scanMock).toHaveBeenCalledTimes(106);
    expect(unlinkMock).toHaveBeenCalledTimes(106);
  });

  it("should not await unlink before scanning the next cursor page", async () => {
    const scanCalls: string[] = [];
    let resolveUnlink: () => void;
    let resolveSecondScan: () => void;
    const secondScanStarted = new Promise<void>((resolve) => {
      resolveSecondScan = resolve;
    });
    const blockUnlink = new Promise<void>((resolve) => {
      resolveUnlink = resolve;
    });

    const scanMock = vi.fn(async (cursor: string) => {
      scanCalls.push(`scan:${cursor}`);
      if (cursor === "0") {
        return ["10", ["prefix:1"]];
      }
      resolveSecondScan!();
      return ["0", []];
    });

    const unlinkMock = vi.fn().mockImplementation(async () => {
      scanCalls.push("unlink");
      await secondScanStarted;
      await blockUnlink;
      return 1;
    });

    const client = {
      scan: scanMock,
      unlink: unlinkMock,
    } as unknown as GlideClient;

    const result = deleteKeysWithPrefix(client, "prefix:*");

    await Promise.resolve();
    await secondScanStarted;
    expect(scanCalls).toEqual(["scan:0", "unlink", "scan:10"]);
    resolveUnlink!();
    await result;

    expect(unlinkMock).toHaveBeenCalledTimes(1);
    expect(scanMock).toHaveBeenCalledTimes(2);
  });
});
