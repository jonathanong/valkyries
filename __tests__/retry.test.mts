import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isRetryableValkeyError, retryValkeyOperation } from "../retry.mts";

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
});
