import { afterEach, describe, expect, it, vi } from "vitest";
import { GlideClient } from "@valkey/valkey-glide";
import {
  ensureDynamicConfigValkeySubscriptionClient,
  closeDynamicConfigValkeySubscriptionClient,
} from "../clients.mts";
import { setValkeyErrorHandler } from "../errors.mts";

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

afterEach(async () => {
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
    ]);
    expect(warning.mock.calls[1]?.[0]).toMatchObject({ errors: [closeError, reporterError] });
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
});
