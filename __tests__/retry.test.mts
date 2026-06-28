import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isRetryableValkeyError,
  isSaturationError,
  retrySaturationError,
  retryValkeyOperation,
} from "../retry.mts";

describe("isRetryableValkeyError", () => {
  it("returns true for inflight saturation error", () => {
    expect(isRetryableValkeyError(new Error("Reached maximum inflight requests"))).toBe(true);
  });

  it("returns true for connection closed error", () => {
    expect(isRetryableValkeyError(new Error("Connection closed unexpectedly"))).toBe(true);
  });

  it("returns true for request timeout error", () => {
    expect(isRetryableValkeyError(new Error("Request timed out after 500ms"))).toBe(true);
  });

  it("returns true for socket closed error", () => {
    expect(isRetryableValkeyError(new Error("Socket was closed"))).toBe(true);
  });

  it("returns true for client closing state error", () => {
    expect(isRetryableValkeyError(new Error("Client is in closing state"))).toBe(true);
  });

  it("returns false for non-Error values", () => {
    expect(isRetryableValkeyError("string error")).toBe(false);
    expect(isRetryableValkeyError(null)).toBe(false);
    expect(isRetryableValkeyError(42)).toBe(false);
    expect(isRetryableValkeyError(undefined)).toBe(false);
  });

  it("returns false for non-transient errors", () => {
    expect(isRetryableValkeyError(new Error("WRONGTYPE Operation against a key"))).toBe(false);
    expect(isRetryableValkeyError(new Error("ERR syntax error"))).toBe(false);
    expect(isRetryableValkeyError(new Error("Out of memory"))).toBe(false);
  });

  it("returns false for non-Error objects with matching message property", () => {
    expect(isRetryableValkeyError({ message: "Reached maximum inflight requests" })).toBe(false);
  });

  it("returns false for Error instances without a message", () => {
    expect(isRetryableValkeyError(new Error())).toBe(false);
  });

  it("returns true for custom errors extending Error", () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "CustomError";
      }
    }
    expect(isRetryableValkeyError(new CustomError("Reached maximum inflight requests"))).toBe(true);
  });

  it("returns false for case-sensitive mismatch", () => {
    // Current implementation uses includes() which is case-sensitive
    expect(isRetryableValkeyError(new Error("reached maximum inflight requests"))).toBe(false);
  });
});

/** Creates a fn that always rejects with a transient inflight error; returns the fn + call counter. */
function makeAlwaysInflightFn() {
  let calls = 0;
  return {
    fn: () => {
      calls++;
      return Promise.reject(new Error("Reached maximum inflight requests"));
    },
    getCalls: () => calls,
  };
}

describe("retryValkeyOperation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately when the operation succeeds on the first attempt", async () => {
    const result = await retryValkeyOperation(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
  });

  it("retries after a transient error and resolves when the operation eventually succeeds", async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      if (attempts < 3) return Promise.reject(new Error("Reached maximum inflight requests"));
      return Promise.resolve("success");
    };

    const promise = retryValkeyOperation(fn, { delayMs: 100 });
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;

    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  it("rethrows non-retryable errors immediately without delay", async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      return Promise.reject(new Error("ERR syntax error"));
    };

    await expect(retryValkeyOperation(fn, { delayMs: 1000 })).rejects.toThrow("ERR syntax error");
    expect(attempts).toBe(1);
  });

  it("rethrows the last error after exhausting all attempts", async () => {
    const { fn, getCalls } = makeAlwaysInflightFn();
    const promise = retryValkeyOperation(fn, { attempts: 3, delayMs: 100 });
    // Attach the rejection handler before advancing timers to avoid unhandled-rejection warnings.
    const check = expect(promise).rejects.toThrow("Reached maximum inflight requests");
    await vi.advanceTimersByTimeAsync(200);
    await check;
    expect(getCalls()).toBe(3);
  });

  it("respects custom shouldRetry — does not retry when shouldRetry returns false", async () => {
    const { fn, getCalls } = makeAlwaysInflightFn();
    await expect(retryValkeyOperation(fn, { shouldRetry: () => false })).rejects.toThrow(
      "Reached maximum inflight requests",
    );
    expect(getCalls()).toBe(1);
  });

  it("waits delayMs between attempts", async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      if (attempts < 2) return Promise.reject(new Error("Reached maximum inflight requests"));
      return Promise.resolve("done");
    };

    const promise = retryValkeyOperation(fn, { delayMs: 500 });
    expect(attempts).toBe(1);

    // Should still be waiting after 499ms
    await vi.advanceTimersByTimeAsync(499);
    expect(attempts).toBe(1);

    // Should attempt again after 500ms
    await vi.advanceTimersByTimeAsync(1);
    const result = await promise;
    expect(result).toBe("done");
    expect(attempts).toBe(2);
  });

  it("uses 3 attempts and 1000ms delay by default", async () => {
    const { fn, getCalls } = makeAlwaysInflightFn();
    const promise = retryValkeyOperation(fn);
    // Attach the rejection handler before advancing timers to avoid unhandled-rejection warnings.
    const check = expect(promise).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(2000);
    await check;
    expect(getCalls()).toBe(3);
  });

  it("jitter: uses a delay in [delayMs, delayMs*5] when jitter is true", async () => {
    // Spy on setTimeout to observe the delay value chosen
    const timeouts: number[] = [];
    const origSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: () => void, ms?: number) => {
      timeouts.push(ms ?? 0);
      // Use real fake timer advance
      return origSetTimeout(fn, ms);
    });

    let attempts = 0;
    const fn = () => {
      attempts++;
      if (attempts < 2) return Promise.reject(new Error("Reached maximum inflight requests"));
      return Promise.resolve("done");
    };

    const promise = retryValkeyOperation(fn, { delayMs: 100, jitter: true });
    await vi.runAllTimersAsync();
    await promise;

    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).toBeGreaterThanOrEqual(100);
    expect(timeouts[0]).toBeLessThanOrEqual(500);

    vi.restoreAllMocks();
  });

  it("jitter: false uses fixed delayMs (no randomization)", async () => {
    const timeouts: number[] = [];
    const origSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: () => void, ms?: number) => {
      timeouts.push(ms ?? 0);
      return origSetTimeout(fn, ms);
    });

    let attempts = 0;
    const fn = () => {
      attempts++;
      if (attempts < 2) return Promise.reject(new Error("Reached maximum inflight requests"));
      return Promise.resolve("done");
    };

    const promise = retryValkeyOperation(fn, { delayMs: 200, jitter: false });
    await vi.runAllTimersAsync();
    await promise;

    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).toBe(200);

    vi.restoreAllMocks();
  });
});

describe("isSaturationError", () => {
  it("returns true for inflight saturation error", () => {
    expect(isSaturationError(new Error("Reached maximum inflight requests"))).toBe(true);
  });

  it("returns false for other retryable errors", () => {
    expect(isSaturationError(new Error("Connection closed"))).toBe(false);
    expect(isSaturationError(new Error("Request timed out"))).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isSaturationError("string")).toBe(false);
    expect(isSaturationError(null)).toBe(false);
    expect(isSaturationError(undefined)).toBe(false);
  });

  it("returns false for non-saturation errors", () => {
    expect(isSaturationError(new Error("ERR syntax error"))).toBe(false);
  });
});

describe("retrySaturationError", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves immediately when the operation succeeds on the first attempt", async () => {
    const result = await retrySaturationError(() => Promise.resolve("ok"));
    expect(result).toBe("ok");
  });

  it("retries on saturation error and resolves when the operation eventually succeeds", async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      if (attempts < 3) return Promise.reject(new Error("Reached maximum inflight requests"));
      return Promise.resolve("success");
    };

    const promise = retrySaturationError(fn, { delayMs: 100 });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe("success");
    expect(attempts).toBe(3);
  });

  it("does not retry non-saturation errors (rethrows immediately)", async () => {
    let attempts = 0;
    const fn = () => {
      attempts++;
      return Promise.reject(new Error("Connection closed unexpectedly"));
    };

    await expect(retrySaturationError(fn, { delayMs: 1000 })).rejects.toThrow("Connection closed");
    expect(attempts).toBe(1);
  });

  it("rethrows the last saturation error after exhausting all attempts", async () => {
    const { fn, getCalls } = makeAlwaysInflightFn();
    const promise = retrySaturationError(fn, { attempts: 3, delayMs: 100 });
    const check = expect(promise).rejects.toThrow("Reached maximum inflight requests");
    await vi.runAllTimersAsync();
    await check;
    expect(getCalls()).toBe(3);
  });

  it("respects custom attempts option", async () => {
    const { fn, getCalls } = makeAlwaysInflightFn();
    const promise = retrySaturationError(fn, { attempts: 2, delayMs: 100 });
    const check = expect(promise).rejects.toThrow();
    await vi.runAllTimersAsync();
    await check;
    expect(getCalls()).toBe(2);
  });

  it("uses jitter so the delay is in [delayMs, delayMs*5]", async () => {
    const timeouts: number[] = [];
    const origSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: () => void, ms?: number) => {
      timeouts.push(ms ?? 0);
      return origSetTimeout(fn, ms);
    });

    let attempts = 0;
    const fn = () => {
      attempts++;
      if (attempts < 2) return Promise.reject(new Error("Reached maximum inflight requests"));
      return Promise.resolve("done");
    };

    const promise = retrySaturationError(fn, { delayMs: 100 });
    await vi.runAllTimersAsync();
    await promise;

    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).toBeGreaterThanOrEqual(100);
    expect(timeouts[0]).toBeLessThanOrEqual(500);

    vi.restoreAllMocks();
  });
});
