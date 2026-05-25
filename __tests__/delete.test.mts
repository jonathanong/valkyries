import { deleteKeysWithPrefix } from "../delete.mts";
import { it, expect, describe, vi, afterEach } from "vitest";
import type { GlideClient } from "@valkey/valkey-glide";
import * as errors from "../errors.mts";

describe("deleteKeysWithPrefix", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should match keys by prefix and delete them", async () => {
    const scanMock = vi
      .fn()
      .mockResolvedValueOnce(["0", ["prefix:key1", "prefix:key2"]]);
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

  it("should handle empty patterns or no matching keys", async () => {
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

    const spy = vi.spyOn(errors, "handleValkeyError").mockImplementation(() => {});

    await expect(deleteKeysWithPrefix(client, "prefix:*")).rejects.toThrow("Scan failed");
    expect(spy).toHaveBeenCalledWith(mockError);
  });

  it("should handle error from unlink and propagate it after calling handleValkeyError", async () => {
    const scanMock = vi.fn().mockResolvedValueOnce(["0", ["prefix:1"]]);
    const mockError = new Error("Unlink failed");
    const unlinkMock = vi.fn().mockRejectedValueOnce(mockError);

    const client = {
      scan: scanMock,
      unlink: unlinkMock,
    } as unknown as GlideClient;

    const spy = vi.spyOn(errors, "handleValkeyError").mockImplementation(() => {});

    await expect(deleteKeysWithPrefix(client, "prefix:*")).rejects.toThrow("Unlink failed");
    expect(scanMock).toHaveBeenCalledTimes(1);
    expect(unlinkMock).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(mockError);
  });
});
