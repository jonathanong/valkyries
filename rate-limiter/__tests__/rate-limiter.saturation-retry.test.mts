/**
 * Unit tests for inflight-saturation retry wired into RateLimiter command paths.
 * Uses fake timers and a mocked GlideClient — no real Valkey needed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlideClient } from "@valkey/valkey-glide";
import { RateLimiter } from "../../rate-limiter.mts";

/**
 * Creates a GlideClient stub whose invokeScript rejects with a saturation error for
 * the first `failCount` calls, then resolves with `successValue`.
 */
function makeTransientSaturationClient(
  failCount: number,
  successValue: unknown,
): { client: GlideClient; callCount: () => number } {
  let calls = 0;
  const client = {
    invokeScript: () => {
      calls++;
      if (calls <= failCount) {
        return Promise.reject(new Error("Reached maximum inflight requests"));
      }
      return Promise.resolve(successValue);
    },
  } as unknown as GlideClient;
  return { client, callCount: () => calls };
}

describe("RateLimiter.saturation-retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("add: retries on saturation and succeeds when the client recovers", async () => {
    const { client, callCount } = makeTransientSaturationClient(2, null);
    const rl = new RateLimiter({
      prefix: "retry-test",
      ttlSeconds: 10,
      client,
      inflightRetryAttempts: 3,
      inflightRetryDelayMs: 50,
    });

    const promise = rl.add(["id-1"]);
    await vi.runAllTimersAsync();
    await promise;

    // 2 failures + 1 success = 3 calls
    expect(callCount()).toBe(3);
  });

  it("add: rethrows after exhausting retry attempts", async () => {
    const { client, callCount } = makeTransientSaturationClient(5, null);
    const rl = new RateLimiter({
      prefix: "retry-test",
      ttlSeconds: 10,
      client,
      inflightRetryAttempts: 2,
      inflightRetryDelayMs: 50,
    });

    const promise = rl.add(["id-1"]);
    const check = expect(promise).rejects.toThrow("Reached maximum inflight requests");
    await vi.runAllTimersAsync();
    await check;

    expect(callCount()).toBe(2);
  });

  it("get: retries on saturation and succeeds when the client recovers", async () => {
    // rateLimiterGetScript returns array of counts; [0] = no rate-limit hits
    const { client, callCount } = makeTransientSaturationClient(2, [0]);
    const rl = new RateLimiter({
      prefix: "retry-test",
      ttlSeconds: 10,
      client,
      inflightRetryAttempts: 3,
      inflightRetryDelayMs: 50,
    });

    const promise = rl.get(["id-1"]);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual([0]);
    expect(callCount()).toBe(3);
  });

  it("addAndCheck: retries on saturation and succeeds when the client recovers", async () => {
    // addAndCheck returns array of counts; [1] = one request recorded
    const { client, callCount } = makeTransientSaturationClient(2, [1]);
    const rl = new RateLimiter({
      prefix: "retry-test",
      ttlSeconds: 10,
      client,
      inflightRetryAttempts: 3,
      inflightRetryDelayMs: 50,
    });

    const promise = rl.addAndCheck(["id-1"], 10);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.counts).toEqual([1]);
    expect(result.limited).toBe(false);
    expect(callCount()).toBe(3);
  });

  it("addAndCheckWindows: retries on saturation and succeeds when the client recovers", async () => {
    // addAndCheckWindows returns [count, limited_flag, ...write_flags]
    // [1, 0, 1] = count=1, not limited, wrote=true
    const { client, callCount } = makeTransientSaturationClient(2, [1, 0, 1]);
    const { client: client2 } = makeTransientSaturationClient(0, [1, 0, 1]);
    void client2;

    const promise = RateLimiter.addAndCheckWindows(
      [
        {
          prefix: "retry-test",
          id: "user-1",
          ttlSeconds: 10,
          threshold: 5,
        },
      ],
      {
        client,
        inflightRetryAttempts: 3,
        inflightRetryDelayMs: 50,
      },
    );
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.limited).toBe(false);
    expect(callCount()).toBe(3);
  });

  it("inflightRetryDelayMs option is passed through to the retry", async () => {
    const timeouts: number[] = [];
    const origSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: () => void, ms?: number) => {
      timeouts.push(ms ?? 0);
      return origSetTimeout(fn, ms);
    });

    const { client } = makeTransientSaturationClient(1, [0]);
    const rl = new RateLimiter({
      prefix: "retry-test",
      ttlSeconds: 10,
      client,
      inflightRetryAttempts: 3,
      inflightRetryDelayMs: 200,
    });

    const promise = rl.get(["id-1"]);
    await vi.runAllTimersAsync();
    await promise;

    // Jitter puts the delay in [200, 1000]
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).toBeGreaterThanOrEqual(200);
    expect(timeouts[0]).toBeLessThanOrEqual(1000);

    vi.restoreAllMocks();
  });
});
