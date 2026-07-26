import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlideClient } from "@valkey/valkey-glide";
import { ValkeyBloomFilter } from "../../bloom-filter.mts";
import { config } from "../../config.mts";
import { setValkeyErrorHandler } from "../../errors.mts";

const saturationError = () => new Error("Reached maximum inflight requests");

function makeFilter(
  client: GlideClient,
  options: Partial<ConstructorParameters<typeof ValkeyBloomFilter>[0]> = {},
) {
  return new ValkeyBloomFilter({
    name: "saturation-retry",
    capacity: 100,
    errorRate: 0.01,
    client,
    inflightRetryAttempts: 3,
    inflightRetryDelayMs: 10,
    ...options,
  });
}

async function settle<T>(promise: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return promise;
}

describe("ValkeyBloomFilter saturation retries", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    setValkeyErrorHandler(() => {});
    vi.useRealTimers();
  });

  it("retries lookup scripts and keeps the fail-open contract after exhaustion", async () => {
    const invokeScript = vi
      .fn()
      .mockRejectedValueOnce(saturationError())
      .mockResolvedValueOnce(1)
      .mockRejectedValue(saturationError());
    const filter = makeFilter({ invokeScript } as unknown as GlideClient);

    await expect(settle(filter.exists("present"))).resolves.toBe(true);
    expect(invokeScript).toHaveBeenCalledTimes(2);

    await expect(settle(filter.exists("missing"))).resolves.toBeNull();
    expect(invokeScript).toHaveBeenCalledTimes(5);
  });

  it("does not retry non-saturation lookup failures", async () => {
    const invokeScript = vi.fn().mockRejectedValue(new Error("WRONGTYPE"));
    const filter = makeFilter({ invokeScript } as unknown as GlideClient);

    await expect(filter.exists("present")).resolves.toBeNull();
    expect(invokeScript).toHaveBeenCalledTimes(1);
  });

  it("uses the config retry defaults when no instance policy is supplied", async () => {
    const invokeScript = vi.fn().mockRejectedValue(saturationError());
    const filter = new ValkeyBloomFilter({
      name: "default-saturation-retry",
      capacity: 100,
      errorRate: 0.01,
      client: { invokeScript } as unknown as GlideClient,
    });

    await settle(filter.exists("item"));
    expect(invokeScript).toHaveBeenCalledTimes(config.inflight_retry_attempts);
  });

  it("forwards the per-instance retry delay", async () => {
    const timeouts: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: () => void, ms?: number) => {
      timeouts.push(ms ?? 0);
      return originalSetTimeout(fn, ms);
    });
    const invokeScript = vi.fn().mockRejectedValueOnce(saturationError()).mockResolvedValueOnce(1);
    const filter = makeFilter({ invokeScript } as unknown as GlideClient, {
      inflightRetryDelayMs: 50,
    });

    await settle(filter.exists("item"));

    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).toBeGreaterThanOrEqual(50);
    expect(timeouts[0]).toBeLessThanOrEqual(250);
    vi.restoreAllMocks();
  });

  it("retries add scripts and waits for every retrier in a concurrent slice before throwing", async () => {
    const invokeScript = vi.fn((_script, { args }: { args: string[] }) => {
      if (args[0] === "fail") return Promise.reject(new Error("command failed"));
      if (
        invokeScript.mock.calls.filter(([, options]) => options.args[0] === "retry").length === 1
      ) {
        return Promise.reject(saturationError());
      }
      return Promise.resolve(1);
    });
    const filter = makeFilter({ invokeScript } as unknown as GlideClient, {
      batchSize: 1,
      concurrencyLimit: 2,
    });

    const promise = filter.addOrThrow(["fail", "retry"]);
    let settled = false;
    void promise.catch(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);

    const check = expect(promise).rejects.toThrow("command failed");
    await vi.runAllTimersAsync();
    await check;
    expect(invokeScript).toHaveBeenCalledTimes(3);
  });

  it("retries rebuild commands independently, including BF.MADD and RENAME", async () => {
    const invokeScript = vi.fn().mockResolvedValue(1);
    const customCommand = vi
      .fn()
      .mockRejectedValueOnce(saturationError())
      .mockResolvedValueOnce([1]);
    const rename = vi.fn().mockRejectedValueOnce(saturationError()).mockResolvedValueOnce("OK");
    const filter = makeFilter({ invokeScript, customCommand, rename } as unknown as GlideClient);

    await settle(
      filter.rebuildFromStream(
        (async function* () {
          yield ["item"];
        })(),
      ),
    );

    expect(customCommand).toHaveBeenCalledTimes(2);
    expect(rename).toHaveBeenCalledTimes(2);
  });

  it("retries ensure, readiness, and deletion command boundaries", async () => {
    const invokeScript = vi.fn().mockRejectedValueOnce(saturationError()).mockResolvedValueOnce(1);
    const customCommand = vi
      .fn()
      .mockRejectedValueOnce(saturationError())
      .mockResolvedValueOnce(1)
      .mockRejectedValueOnce(saturationError())
      .mockResolvedValueOnce(2);
    const unlink = vi.fn().mockRejectedValueOnce(saturationError()).mockResolvedValueOnce(2);
    const filter = makeFilter({ invokeScript, customCommand, unlink } as unknown as GlideClient);

    await settle(filter.ensureExists());
    await settle(filter.keyExists());
    await settle(filter.isReady("ready"));
    await settle(filter.deleteWithAdditionalKeys(["ready"]));

    expect(invokeScript).toHaveBeenCalledTimes(2);
    expect(customCommand).toHaveBeenCalledTimes(4);
    expect(unlink).toHaveBeenCalledTimes(2);
  });

  it("retries saturated cleanup and preserves the original rebuild failure", async () => {
    const reported: Error[] = [];
    setValkeyErrorHandler((error) => reported.push(error));
    const invokeScript = vi.fn().mockResolvedValue(1);
    const customCommand = vi.fn().mockRejectedValue(new Error("BF.MADD failed"));
    const unlink = vi.fn().mockRejectedValue(saturationError());
    const filter = makeFilter({ invokeScript, customCommand, unlink } as unknown as GlideClient, {
      inflightRetryAttempts: 2,
    });

    const check = expect(
      filter.rebuildFromStream(
        (async function* () {
          yield ["item"];
        })(),
      ),
    ).rejects.toThrow("BF.MADD failed");
    await vi.runAllTimersAsync();
    await check;

    expect(unlink).toHaveBeenCalledTimes(2);
    expect(reported).toHaveLength(1);
    expect(reported[0]?.message).toContain("Reached maximum inflight requests");
  });

  it("absorbs exhausted saturation errors from add() after reporting them", async () => {
    const reported: Error[] = [];
    setValkeyErrorHandler((error) => reported.push(error));
    const invokeScript = vi.fn().mockRejectedValue(saturationError());
    const filter = makeFilter({ invokeScript } as unknown as GlideClient, {
      inflightRetryAttempts: 2,
    });

    const promise = filter.add(["item"]);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();

    expect(invokeScript).toHaveBeenCalledTimes(2);
    expect(reported).toHaveLength(1);
    expect(reported[0]?.message).toContain("Reached maximum inflight requests");
  });

  it("propagates exhausted saturation errors from throwing write operations", async () => {
    const invokeScript = vi.fn().mockRejectedValue(saturationError());
    const filter = makeFilter({ invokeScript } as unknown as GlideClient, {
      inflightRetryAttempts: 2,
    });

    const check = expect(filter.addOrThrow(["item"])).rejects.toThrow(
      "Reached maximum inflight requests",
    );
    await vi.runAllTimersAsync();
    await check;
    expect(invokeScript).toHaveBeenCalledTimes(2);
  });
});
