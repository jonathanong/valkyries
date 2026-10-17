import { afterEach, describe, expect, it, vi } from "vitest";
import { scanAndUnlinkKeyPrefixes } from "../delete.mts";
import type { ScanAndUnlinkKeysClient } from "../types.mts";

const { mockHandleValkeyError } = vi.hoisted(() => ({ mockHandleValkeyError: vi.fn() }));

vi.mock("../errors.mts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../errors.mts")>()),
  handleValkeyError: mockHandleValkeyError,
}));

function makeClient(scan = vi.fn(), unlink = vi.fn()): ScanAndUnlinkKeysClient {
  return { scan, unlink } as unknown as ScanAndUnlinkKeysClient;
}

function scanPatterns(scan: ReturnType<typeof vi.fn>): string[] {
  return scan.mock.calls.map((call) => (call[1] as { match: string }).match);
}

describe("scanAndUnlinkKeyPrefixes", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sums unlinked keys across distinct prefixes", async () => {
    const scan = vi.fn().mockResolvedValue(["0", ["k"]]);
    const unlink = vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(3);

    await expect(
      scanAndUnlinkKeyPrefixes(makeClient(scan, unlink), ["a:", "b:", "a:"]),
    ).resolves.toEqual({ unlinkedKeys: 5 });
    expect(scanPatterns(scan)).toEqual(["a:*", "b:*"]);
  });

  it("returns zero without scanning when there are no prefixes", async () => {
    const scan = vi.fn();
    await expect(scanAndUnlinkKeyPrefixes(makeClient(scan), [])).resolves.toEqual({
      unlinkedKeys: 0,
    });
    expect(scan).not.toHaveBeenCalled();
  });

  it("glob-escapes prefixes", async () => {
    const scan = vi.fn().mockResolvedValue(["0", []]);
    await scanAndUnlinkKeyPrefixes(makeClient(scan), ["a*b?c[d]e\\f"]);
    expect(scanPatterns(scan)).toEqual(["a\\*b\\?c\\[d\\]e\\\\f*"]);
  });

  it("rejects empty or non-string prefixes before scanning", async () => {
    const scan = vi.fn();
    const client = makeClient(scan);
    await expect(scanAndUnlinkKeyPrefixes(client, ["a:", ""])).rejects.toBeInstanceOf(TypeError);
    await expect(scanAndUnlinkKeyPrefixes(client, [1 as unknown as string])).rejects.toBeInstanceOf(
      TypeError,
    );
    expect(scan).not.toHaveBeenCalled();
  });

  it("continues after one failure and rethrows it as-is, reported once", async () => {
    const error = new Error("boom");
    const scan = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(["0", ["k"]]);
    const unlink = vi.fn().mockResolvedValue(1);

    await expect(scanAndUnlinkKeyPrefixes(makeClient(scan, unlink), ["a:", "b:"])).rejects.toBe(
      error,
    );
    expect(scan).toHaveBeenCalledTimes(2);
    expect(unlink).toHaveBeenCalledTimes(1);
    expect(mockHandleValkeyError).toHaveBeenCalledTimes(1);
    expect(mockHandleValkeyError).toHaveBeenCalledWith(error);
  });

  it("combines several failures into an AggregateError with the unlinked count", async () => {
    const first = new Error("one");
    const second = new Error("two");
    const scan = vi
      .fn()
      .mockRejectedValueOnce(first)
      .mockResolvedValueOnce(["0", ["k"]])
      .mockRejectedValueOnce(second);
    const unlink = vi.fn().mockResolvedValue(4);

    const err = await scanAndUnlinkKeyPrefixes(makeClient(scan, unlink), ["a:", "b:", "c:"]).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(AggregateError);
    expect((err as AggregateError).errors).toEqual([first, second]);
    expect((err as AggregateError & { unlinkedKeys: number }).unlinkedKeys).toBe(4);
    expect((err as Error).message).toBe("2 prefix scans failed after unlinking 4 keys");
    expect(mockHandleValkeyError).toHaveBeenCalledTimes(2);
  });

  it("does not start another prefix when aborted between prefixes", async () => {
    const reason = new Error("stop");
    const scan = vi.fn().mockResolvedValue(["0", []]);
    // An empty single-page scan reads `aborted` three times; abort only after the first prefix.
    let reads = 0;
    const signal = {
      get aborted() {
        reads += 1;
        return reads > 3;
      },
      reason,
    } as unknown as AbortSignal;

    await expect(scanAndUnlinkKeyPrefixes(makeClient(scan), ["a:", "b:"], { signal })).rejects.toBe(
      reason,
    );
    expect(scan).toHaveBeenCalledTimes(1);
    expect(mockHandleValkeyError).not.toHaveBeenCalled();
  });

  it("rethrows the abort reason when it interrupts a prefix without reporting it", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    const scan = vi.fn().mockResolvedValue(["0", ["k"]]);
    const options = {
      signal: controller.signal,
      matches: () => {
        controller.abort(reason);
        return false;
      },
    };

    await expect(scanAndUnlinkKeyPrefixes(makeClient(scan), ["a:", "b:"], options)).rejects.toBe(
      reason,
    );
    expect(scan).toHaveBeenCalledTimes(1);
    expect(mockHandleValkeyError).not.toHaveBeenCalled();
  });

  it("rethrows an abort reason raised mid-prefix even after earlier failures", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    const scan = vi
      .fn()
      .mockRejectedValueOnce(new Error("first"))
      .mockImplementationOnce(() => {
        controller.abort(reason);
        return Promise.resolve(["0", []]);
      });

    await expect(
      scanAndUnlinkKeyPrefixes(makeClient(scan), ["a:", "b:", "c:"], { signal: controller.signal }),
    ).rejects.toBe(reason);
    expect(scan).toHaveBeenCalledTimes(2);
  });
});
