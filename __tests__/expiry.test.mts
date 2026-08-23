import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Decoder, type GlideClient, type GlideString } from "@valkey/valkey-glide";
import { setValkeyErrorHandler } from "../errors.mts";
import { expireKeysWithNoExpiry } from "../expiry.mts";

const mockHandleValkeyError = vi.fn();

describe("expireKeysWithNoExpiry", () => {
  beforeEach(() => {
    setValkeyErrorHandler(mockHandleValkeyError);
  });

  afterEach(() => {
    vi.clearAllMocks();
    setValkeyErrorHandler(() => {});
  });

  it("scans pages in non-atomic batches and returns confirmed expiry counts", async () => {
    const scanMock = vi
      .fn()
      .mockResolvedValueOnce([Buffer.from("10"), ["key:one", "key:two"]])
      .mockResolvedValueOnce([Buffer.from("0"), ["key:three"]]);
    const execMock = vi.fn().mockResolvedValueOnce([true, false]).mockResolvedValueOnce([true]);
    const client = { scan: scanMock, exec: execMock } as unknown as GlideClient;

    await expect(expireKeysWithNoExpiry(client, { pattern: "key:*", ttl: 60 })).resolves.toEqual({
      scannedKeys: 3,
      matchedKeys: 3,
      expiredKeys: 2,
    });
    expect(scanMock).toHaveBeenNthCalledWith(1, "0", {
      match: "key:*",
      count: 500,
      decoder: Decoder.Bytes,
    });
    expect(scanMock).toHaveBeenNthCalledWith(2, "10", {
      match: "key:*",
      count: 500,
      decoder: Decoder.Bytes,
    });
    expect(execMock).toHaveBeenCalledTimes(2);
    expect(execMock.mock.calls[0]![0]).toMatchObject({ isAtomic: false });
    expect(execMock).toHaveBeenNthCalledWith(1, expect.anything(), true);
  });

  it("uses EXPIRE NX so concurrent expiry changes are not overwritten", async () => {
    const scanMock = vi.fn().mockResolvedValueOnce([Buffer.from("0"), ["key:one", "key:two"]]);
    const execMock = vi.fn().mockResolvedValueOnce([true, false]);
    const client = { scan: scanMock, exec: execMock } as unknown as GlideClient;

    await expect(expireKeysWithNoExpiry(client, { pattern: "key:*", ttl: 60 })).resolves.toEqual({
      scannedKeys: 2,
      matchedKeys: 2,
      expiredKeys: 1,
    });
  });

  it("chunks a SCAN page separately from the scan hint", async () => {
    const scanMock = vi.fn().mockResolvedValueOnce(["0", ["key:one", "key:two", "key:three"]]);
    const execMock = vi.fn().mockResolvedValueOnce([true, true]).mockResolvedValueOnce([true]);
    const client = { scan: scanMock, exec: execMock } as unknown as GlideClient;

    await expect(
      expireKeysWithNoExpiry(client, {
        pattern: "key:*",
        ttl: 60,
        scanCount: 10,
        batchSize: 2,
      }),
    ).resolves.toEqual({ scannedKeys: 3, matchedKeys: 3, expiredKeys: 3 });
    expect(scanMock).toHaveBeenCalledWith("0", {
      match: "key:*",
      count: 10,
      decoder: Decoder.Bytes,
    });
    expect(execMock).toHaveBeenCalledTimes(2);
  });

  it("passes Buffer keys to shouldExpire and honors custom scanCount", async () => {
    const binaryKey = Buffer.from("key:binary");
    const shouldExpire = vi.fn((key: GlideString) => Buffer.isBuffer(key));
    const scanMock = vi.fn().mockResolvedValueOnce([Buffer.from("0"), [binaryKey, "key:skip"]]);
    const execMock = vi.fn().mockResolvedValueOnce([true]);
    const client = { scan: scanMock, exec: execMock } as unknown as GlideClient;

    await expect(
      expireKeysWithNoExpiry(client, { pattern: "key:*", ttl: 90, shouldExpire, scanCount: 7 }),
    ).resolves.toEqual({ scannedKeys: 2, matchedKeys: 1, expiredKeys: 1 });
    expect(shouldExpire).toHaveBeenNthCalledWith(1, binaryKey, 0, [binaryKey, "key:skip"]);
    expect(scanMock).toHaveBeenCalledWith("0", {
      match: "key:*",
      count: 7,
      decoder: Decoder.Bytes,
    });
  });

  it("returns zero matched and expired keys when every scanned key is filtered out", async () => {
    const scanMock = vi.fn().mockResolvedValueOnce([Buffer.from("0"), ["key:one", "key:two"]]);
    const execMock = vi.fn();
    const client = { scan: scanMock, exec: execMock } as unknown as GlideClient;

    await expect(
      expireKeysWithNoExpiry(client, {
        pattern: "key:*",
        ttl: 60,
        shouldExpire: () => false,
      }),
    ).resolves.toEqual({ scannedKeys: 2, matchedKeys: 0, expiredKeys: 0 });
    expect(execMock).not.toHaveBeenCalled();
  });

  it("does not scan when the signal is already aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("stop before scan");
    controller.abort(reason);
    const scanMock = vi.fn();
    const client = { scan: scanMock } as unknown as GlideClient;

    await expect(
      expireKeysWithNoExpiry(client, { pattern: "key:*", ttl: 60, signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(scanMock).not.toHaveBeenCalled();
    expect(mockHandleValkeyError).not.toHaveBeenCalled();
  });

  it("stops after a pending scan resolves when the signal aborts", async () => {
    const controller = new AbortController();
    const reason = new Error("stop after pending scan");
    let resolveScan: (result: [Buffer, string[]]) => void;
    const pendingScan = new Promise<[Buffer, string[]]>((resolve) => {
      resolveScan = resolve;
    });
    const scanMock = vi.fn().mockReturnValueOnce(pendingScan);
    const shouldExpire = vi.fn(() => true);
    const execMock = vi.fn();
    const client = { scan: scanMock, exec: execMock } as unknown as GlideClient;

    const result = expireKeysWithNoExpiry(client, {
      pattern: "key:*",
      ttl: 60,
      signal: controller.signal,
      shouldExpire,
    });
    await vi.waitFor(() => expect(scanMock).toHaveBeenCalledOnce());
    controller.abort(reason);
    resolveScan!([Buffer.from("0"), ["key:one"]]);

    await expect(result).rejects.toBe(reason);
    expect(shouldExpire).not.toHaveBeenCalled();
    expect(execMock).not.toHaveBeenCalled();
    expect(mockHandleValkeyError).not.toHaveBeenCalled();
  });

  it("stops after a pending batch resolves when the signal aborts", async () => {
    const controller = new AbortController();
    const reason = new Error("stop after pending batch");
    let resolveExec: (result: boolean[]) => void;
    const pendingExec = new Promise<boolean[]>((resolve) => {
      resolveExec = resolve;
    });
    const scanMock = vi.fn().mockResolvedValueOnce([Buffer.from("0"), ["key:one"]]);
    const execMock = vi.fn().mockReturnValueOnce(pendingExec);
    const client = { scan: scanMock, exec: execMock } as unknown as GlideClient;

    const result = expireKeysWithNoExpiry(client, {
      pattern: "key:*",
      ttl: 60,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(execMock).toHaveBeenCalledOnce());
    controller.abort(reason);
    resolveExec!([true]);

    await expect(result).rejects.toBe(reason);
    expect(mockHandleValkeyError).not.toHaveBeenCalled();
  });

  it("stops between batch executions when the signal aborts", async () => {
    const controller = new AbortController();
    const reason = new Error("stop between batches");
    const scanMock = vi.fn().mockResolvedValueOnce([Buffer.from("0"), ["key:one", "key:two"]]);
    const execMock = vi.fn(() => {
      controller.abort(reason);
      return Promise.resolve([true]);
    });
    const client = { scan: scanMock, exec: execMock } as unknown as GlideClient;

    await expect(
      expireKeysWithNoExpiry(client, {
        pattern: "key:*",
        ttl: 60,
        batchSize: 1,
        signal: controller.signal,
      }),
    ).rejects.toBe(reason);
    expect(execMock).toHaveBeenCalledOnce();
    expect(mockHandleValkeyError).not.toHaveBeenCalled();
  });

  it("reports malformed batch responses through handleValkeyError", async () => {
    const scanMock = vi.fn().mockResolvedValueOnce([Buffer.from("0"), ["key:one"]]);
    const execMock = vi.fn().mockResolvedValueOnce(null);
    const client = { scan: scanMock, exec: execMock } as unknown as GlideClient;

    await expect(expireKeysWithNoExpiry(client, { pattern: "key:*", ttl: 60 })).rejects.toThrow(
      "unexpected EXPIRE batch response",
    );
    expect(mockHandleValkeyError).toHaveBeenCalledOnce();

    vi.clearAllMocks();
    const mismatchScanMock = vi.fn().mockResolvedValueOnce([Buffer.from("0"), ["key:one"]]);
    const mismatchExecMock = vi.fn().mockResolvedValueOnce([]);
    const mismatchClient = {
      scan: mismatchScanMock,
      exec: mismatchExecMock,
    } as unknown as GlideClient;
    await expect(
      expireKeysWithNoExpiry(mismatchClient, { pattern: "key:*", ttl: 60 }),
    ).rejects.toThrow("unexpected EXPIRE batch response");
    expect(mockHandleValkeyError).toHaveBeenCalledOnce();
  });

  it("rejects invalid TTL, scan count, and batch size values", async () => {
    const client = {} as GlideClient;

    await expect(expireKeysWithNoExpiry(client, { pattern: "key:*", ttl: 0 })).rejects.toThrow(
      "ttl must be a positive safe integer",
    );
    await expect(expireKeysWithNoExpiry(client, { pattern: "key:*", ttl: 1.5 })).rejects.toThrow(
      "ttl must be a positive safe integer",
    );
    await expect(
      expireKeysWithNoExpiry(client, { pattern: "key:*", ttl: 60, scanCount: 0 }),
    ).rejects.toThrow("scanCount must be a positive safe integer");
    await expect(
      expireKeysWithNoExpiry(client, { pattern: "key:*", ttl: 60, batchSize: Number.NaN }),
    ).rejects.toThrow("batchSize must be a positive safe integer");
  });

  it("stops after predicate evaluation when the signal aborts", async () => {
    const controller = new AbortController();
    const reason = new Error("stop after predicate");
    const scanMock = vi.fn().mockResolvedValueOnce([Buffer.from("0"), ["key:one"]]);
    const execMock = vi.fn();
    const client = { scan: scanMock, exec: execMock } as unknown as GlideClient;

    await expect(
      expireKeysWithNoExpiry(client, {
        pattern: "key:*",
        ttl: 60,
        signal: controller.signal,
        shouldExpire: () => {
          controller.abort(reason);
          return false;
        },
      }),
    ).rejects.toBe(reason);
    expect(execMock).not.toHaveBeenCalled();
    expect(mockHandleValkeyError).not.toHaveBeenCalled();
  });

  it("reports scan and batch errors through handleValkeyError", async () => {
    const scanError = new Error("scan failed");
    const scanMock = vi.fn().mockRejectedValueOnce(scanError);
    const scanClient = { scan: scanMock } as unknown as GlideClient;
    await expect(expireKeysWithNoExpiry(scanClient, { pattern: "key:*", ttl: 60 })).rejects.toBe(
      scanError,
    );
    expect(mockHandleValkeyError).toHaveBeenCalledWith(scanError);

    vi.clearAllMocks();
    const execError = new Error("batch failed");
    const batchScanMock = vi.fn().mockResolvedValueOnce([Buffer.from("0"), ["key:one"]]);
    const execMock = vi.fn().mockRejectedValueOnce(execError);
    const batchClient = { scan: batchScanMock, exec: execMock } as unknown as GlideClient;
    await expect(expireKeysWithNoExpiry(batchClient, { pattern: "key:*", ttl: 60 })).rejects.toBe(
      execError,
    );
    expect(mockHandleValkeyError).toHaveBeenCalledWith(execError);
  });
});
