import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlideClient } from "@valkey/valkey-glide";
import {
  ensureDynamicConfigValkeySubscriptionClient,
  closeDynamicConfigValkeySubscriptionClient,
} from "../clients.mts";
import { setValkeyErrorHandler } from "../errors.mts";
import { config } from "../config.mts";

vi.mock<typeof import("@valkey/valkey-glide")>(
  import("@valkey/valkey-glide"),
  async (importOriginal) => {
    const actual = await importOriginal();
    return {
      ...actual,
      GlideClient: class extends actual.GlideClient {
        static override createClient = vi
          .fn<typeof actual.GlideClient.createClient>()
          .mockResolvedValue({} as GlideClient);
      },
    };
  },
);

const create = () => vi.spyOn(GlideClient, "createClient");
function client() {
  return {
    close: vi.fn(),
    punsubscribe: vi.fn().mockResolvedValue(undefined),
  } as unknown as GlideClient;
}

const defaultAttempts = config.subscription_creation_attempts;

beforeEach(() => {
  // Deadline semantics are tested per attempt; retry behavior has its own describe block.
  config.subscription_creation_attempts = 1;
});

afterEach(async () => {
  config.subscription_creation_attempts = defaultAttempts;
  vi.useRealTimers();
  await closeDynamicConfigValkeySubscriptionClient();
  setValkeyErrorHandler(() => {});
  vi.restoreAllMocks();
});

describe("DynamicConfig subscription creation deadline", () => {
  it("rejects a stalled shared creation, clears the attempt, and closes its late client", async () => {
    vi.useFakeTimers();
    const old = Promise.withResolvers<GlideClient>();
    create().mockReturnValueOnce(old.promise);
    const first = ensureDynamicConfigValkeySubscriptionClient();
    expect(ensureDynamicConfigValkeySubscriptionClient()).toBe(first);
    const rejected = expect(first).rejects.toThrow("subscription client creation timed out");
    await vi.advanceTimersByTimeAsync(5_000);
    await rejected;
    const replacement = client();
    create().mockResolvedValueOnce(replacement);
    expect(await ensureDynamicConfigValkeySubscriptionClient()).toBe(replacement);
    const late = client();
    old.resolve(late);
    await old.promise;
    await Promise.resolve();
    expect(vi.mocked(late).close.mock.calls).toHaveLength(1);
    expect(await ensureDynamicConfigValkeySubscriptionClient()).toBe(replacement);
    expect(create()).toHaveBeenCalledTimes(2);
    expect(create().mock.calls[0]?.[0].advancedConfiguration?.connectionTimeout).toBe(2_000);
  });

  it("preserves native rejection identity and permits a later explicit attempt", async () => {
    const error = new Error("handshake failed");
    create().mockRejectedValueOnce(error);
    await expect(ensureDynamicConfigValkeySubscriptionClient()).rejects.toBe(error);
    const next = client();
    create().mockResolvedValueOnce(next);
    expect(await ensureDynamicConfigValkeySubscriptionClient()).toBe(next);
  });

  it("observes native rejection after expiry without discarding the replacement", async () => {
    vi.useFakeTimers();
    const old = Promise.withResolvers<GlideClient>();
    create().mockReturnValueOnce(old.promise);
    const rejection = expect(ensureDynamicConfigValkeySubscriptionClient()).rejects.toThrow(
      "timed out",
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;
    const next = client();
    create().mockResolvedValueOnce(next);
    expect(await ensureDynamicConfigValkeySubscriptionClient()).toBe(next);
    old.reject(new Error("late handshake failure"));
    await Promise.resolve();
    await Promise.resolve();
    expect(await ensureDynamicConfigValkeySubscriptionClient()).toBe(next);
  });
  it("preserves a native failure when the public error reporter throws", async () => {
    const warning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    const nativeError = new Error("native handshake failed");
    const reporterError = new Error("reporter failed");
    setValkeyErrorHandler(() => {
      throw reporterError;
    });
    create().mockRejectedValueOnce(nativeError);
    await expect(ensureDynamicConfigValkeySubscriptionClient()).rejects.toBe(nativeError);
    expect(warning.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ cause: reporterError }));
  });

  it("observes a late close failure and a throwing reporter without an unhandled rejection", async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    const reporterError = new Error("late reporter failed");
    const closeError = new Error("late close failed");
    setValkeyErrorHandler(() => {
      throw reporterError;
    });
    const pending = Promise.withResolvers<GlideClient>();
    create().mockReturnValueOnce(pending.promise);
    const rejection = expect(ensureDynamicConfigValkeySubscriptionClient()).rejects.toThrow(
      "timed out",
    );
    await vi.advanceTimersByTimeAsync(5_000);
    await rejection;
    const late = client();
    vi.mocked(late).close.mockImplementation(() => {
      throw closeError;
    });
    pending.resolve(late);
    await pending.promise;
    await Promise.resolve();
    await Promise.resolve();
    expect(warning.mock.calls.map(([error]) => (error as Error).cause)).toEqual([
      reporterError,
      reporterError,
      reporterError,
    ]);
    expect(warning.mock.calls[1]?.[0]).toMatchObject({
      errors: [
        expect.objectContaining({ message: expect.stringContaining("finished after") }),
        reporterError,
      ],
    });
    expect(warning.mock.calls[2]?.[0]).toMatchObject({ errors: [closeError, reporterError] });
  });

  it("closes a creation owned by shutdown without replacing a newer cached client", async () => {
    const pending = Promise.withResolvers<GlideClient>();
    create().mockReturnValueOnce(pending.promise);
    const original = ensureDynamicConfigValkeySubscriptionClient();
    const shutdown = closeDynamicConfigValkeySubscriptionClient();
    const replacement = client();
    create().mockResolvedValueOnce(replacement);
    expect(await ensureDynamicConfigValkeySubscriptionClient()).toBe(replacement);
    const old = client();
    pending.resolve(old);
    await original;
    await shutdown;
    expect(vi.mocked(old).close.mock.calls).toHaveLength(1);
    expect(await ensureDynamicConfigValkeySubscriptionClient()).toBe(replacement);
  });
  it("keeps a replacement cached when shutdown's older creation rejects", async () => {
    const pending = Promise.withResolvers<GlideClient>();
    create().mockReturnValueOnce(pending.promise);
    const failure = new Error("old connection failed during shutdown");
    const original = expect(ensureDynamicConfigValkeySubscriptionClient()).rejects.toBe(failure);
    const shutdown = expect(closeDynamicConfigValkeySubscriptionClient()).rejects.toBe(failure);
    const replacement = client();
    create().mockResolvedValueOnce(replacement);
    expect(await ensureDynamicConfigValkeySubscriptionClient()).toBe(replacement);
    pending.reject(failure);
    await original;
    await shutdown;
    expect(await ensureDynamicConfigValkeySubscriptionClient()).toBe(replacement);
  });
});

describe("DynamicConfig subscription creation retries", () => {
  beforeEach(() => {
    config.subscription_creation_attempts = 3;
  });

  it("retries a slow first creation and reports how long the late creation took", async () => {
    vi.useFakeTimers();
    const reported: Error[] = [];
    setValkeyErrorHandler((error) => reported.push(error));
    const slow = Promise.withResolvers<GlideClient>();
    const next = client();
    create().mockReturnValueOnce(slow.promise).mockResolvedValueOnce(next);
    const pending = ensureDynamicConfigValkeySubscriptionClient();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reported[0]?.message).toBe(
      "DynamicConfig subscription client creation timed out after 5000 ms " +
        "(attempt 1/3, deadline fired after 5000 ms)",
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await pending).toBe(next);
    expect(create()).toHaveBeenCalledTimes(2);
    const late = client();
    await vi.advanceTimersByTimeAsync(2_000);
    slow.resolve(late);
    await slow.promise;
    await Promise.resolve();
    expect(vi.mocked(late).close.mock.calls).toHaveLength(1);
    expect(reported[1]?.message).toBe(
      "DynamicConfig subscription client creation finished after 8000 ms, past its 5000 ms " +
        "deadline (attempt 1/3); closing the late client",
    );
    expect(await ensureDynamicConfigValkeySubscriptionClient()).toBe(next);
  });

  it("rejects with the last attempt's error after bounded backoff and clears the cache", async () => {
    vi.useFakeTimers();
    const errors = [new Error("first"), new Error("second"), new Error("third")];
    for (const error of errors) create().mockRejectedValueOnce(error);
    const result = expect(ensureDynamicConfigValkeySubscriptionClient()).rejects.toBe(errors[2]);
    await vi.advanceTimersByTimeAsync(999);
    expect(create()).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(create()).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2_000);
    await result;
    expect(create()).toHaveBeenCalledTimes(3);
    const next = client();
    create().mockResolvedValueOnce(next);
    expect(await ensureDynamicConfigValkeySubscriptionClient()).toBe(next);
  });

  it("caps the backoff delay", async () => {
    vi.useFakeTimers();
    config.subscription_creation_attempts = 5;
    for (let i = 0; i < 4; i++) create().mockRejectedValueOnce(new Error(`fail ${i}`));
    const next = client();
    create().mockResolvedValueOnce(next);
    const pending = ensureDynamicConfigValkeySubscriptionClient();
    await vi.advanceTimersByTimeAsync(1_000 + 2_000 + 4_000 + 4_999);
    expect(create()).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(1);
    expect(await pending).toBe(next);
  });

  it("stops retrying when shutdown detaches the attempt during backoff", async () => {
    vi.useFakeTimers();
    const failure = new Error("first attempt failed");
    create().mockRejectedValueOnce(failure);
    const original = expect(ensureDynamicConfigValkeySubscriptionClient()).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(0);
    const shutdown = expect(closeDynamicConfigValkeySubscriptionClient()).rejects.toBe(failure);
    await vi.advanceTimersByTimeAsync(1_000);
    await original;
    await shutdown;
    expect(create()).toHaveBeenCalledTimes(1);
  });

  it("stops retrying when shutdown detaches the attempt before it fails", async () => {
    const pending = Promise.withResolvers<GlideClient>();
    create().mockReturnValueOnce(pending.promise);
    const failure = new Error("failed during shutdown");
    const original = expect(ensureDynamicConfigValkeySubscriptionClient()).rejects.toBe(failure);
    const shutdown = expect(closeDynamicConfigValkeySubscriptionClient()).rejects.toBe(failure);
    pending.reject(failure);
    await original;
    await shutdown;
    expect(create()).toHaveBeenCalledTimes(1);
  });
});
