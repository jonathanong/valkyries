/* oxlint-disable vitest/prefer-import-in-mock, jest/no-untyped-mock-factory -- typed dynamic mock factories are too strict for this partial test mock */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockUrlsToClients,
  mockCloseDynamicConfigValkeySubscriptionClient,
  mockDynamicConfigs,
  mockHandleValkeyError,
} = vi.hoisted(() => ({
  mockUrlsToClients: new Map<string, { close: ReturnType<typeof vi.fn> }>(),
  mockCloseDynamicConfigValkeySubscriptionClient: vi.fn(() => Promise.resolve()),
  mockDynamicConfigs: new Set<{ close: ReturnType<typeof vi.fn> }>(),
  mockHandleValkeyError: vi.fn(),
}));

vi.mock("../clients.mts", () => ({
  urlsToClients: mockUrlsToClients,
  closeDynamicConfigValkeySubscriptionClient: mockCloseDynamicConfigValkeySubscriptionClient,
}));

vi.mock("../dynamic-config.mts", () => ({
  dynamicConfigs: mockDynamicConfigs,
}));

vi.mock("../errors.mts", () => ({
  handleValkeyError: mockHandleValkeyError,
}));

describe("valkey shutdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUrlsToClients.clear();
    mockDynamicConfigs.clear();
  });

  it("closes dynamic configs and valkey clients", async () => {
    vi.resetModules();
    const { onGracefulShutdown } = await import("../shutdown.mts");

    const dynamicConfig = { close: vi.fn() };
    mockDynamicConfigs.add(dynamicConfig);

    const valkeyClient = { close: vi.fn(() => Promise.resolve()) };
    mockUrlsToClients.set("redis://localhost:6379", valkeyClient);

    await onGracefulShutdown();

    expect(dynamicConfig.close).toHaveBeenCalledTimes(1);
    expect(valkeyClient.close).toHaveBeenCalledTimes(1);
    expect(mockCloseDynamicConfigValkeySubscriptionClient).toHaveBeenCalledTimes(1);
    expect(mockHandleValkeyError).not.toHaveBeenCalled();
  });

  it("routes dynamic config close errors to the error handler", async () => {
    vi.resetModules();
    const { onGracefulShutdown } = await import("../shutdown.mts");

    const error = new Error("config close failed");
    mockDynamicConfigs.add({
      close: vi.fn(() => {
        throw error;
      }),
    });

    await onGracefulShutdown();

    expect(mockHandleValkeyError).toHaveBeenCalledWith(error);
    expect(mockCloseDynamicConfigValkeySubscriptionClient).toHaveBeenCalledTimes(1);
  });

  it("routes valkey client close errors to the error handler", async () => {
    vi.resetModules();
    const { onGracefulShutdown } = await import("../shutdown.mts");

    const error = new Error("client close failed");
    mockUrlsToClients.set("redis://localhost:6379", {
      close: vi.fn(() => Promise.reject(error)),
    });

    await onGracefulShutdown();

    expect(mockHandleValkeyError).toHaveBeenCalledWith(error);
  });

  it("is idempotent", async () => {
    vi.resetModules();
    const { onGracefulShutdown } = await import("../shutdown.mts");

    const valkeyClient = { close: vi.fn(() => Promise.resolve()) };
    mockUrlsToClients.set("redis://localhost:6379", valkeyClient);

    await onGracefulShutdown();
    await onGracefulShutdown();

    expect(valkeyClient.close).toHaveBeenCalledTimes(1);
    expect(mockCloseDynamicConfigValkeySubscriptionClient).toHaveBeenCalledTimes(1);
  });

  it("converts non-Error rejections to Error objects", async () => {
    vi.resetModules();
    const { onGracefulShutdown } = await import("../shutdown.mts");

    mockDynamicConfigs.add({
      close: vi.fn(() => {
        // oxlint-disable-next-line no-throw-literal
        throw "string error";
      }),
    });

    await onGracefulShutdown();

    expect(mockHandleValkeyError).toHaveBeenCalledTimes(1);
    const arg = mockHandleValkeyError.mock.calls[0]![0];
    expect(arg).toBeInstanceOf(Error);
    expect(arg.message).toBe("string error");
  });

  describe("throwOnError", () => {
    it("rejects with an AggregateError of config and client failures after reporting each", async () => {
      vi.resetModules();
      const { closeValkeyClients } = await import("../shutdown.mts");

      const configError = new Error("config close failed");
      const clientError = new Error("client close failed");
      const subscriptionError = new Error("subscription close failed");
      mockDynamicConfigs.add({ close: vi.fn(() => Promise.reject(configError)) });
      const goodClient = { close: vi.fn(() => Promise.resolve()) };
      mockUrlsToClients.set("redis://a", goodClient);
      mockUrlsToClients.set("redis://b", { close: vi.fn(() => Promise.reject(clientError)) });
      mockCloseDynamicConfigValkeySubscriptionClient.mockImplementationOnce(() =>
        Promise.reject(subscriptionError),
      );

      const rejection = await closeValkeyClients({ throwOnError: true }).catch((e: unknown) => e);

      expect(rejection).toBeInstanceOf(AggregateError);
      const aggregate = rejection as AggregateError;
      expect(aggregate.message).toBe("Valkey shutdown failed");
      expect(aggregate.errors).toEqual([configError, clientError, subscriptionError]);
      expect(mockHandleValkeyError).toHaveBeenCalledTimes(3);
      expect(goodClient.close).toHaveBeenCalledTimes(1);
    });

    it("resolves when nothing fails", async () => {
      vi.resetModules();
      const { closeValkeyClients } = await import("../shutdown.mts");
      mockUrlsToClients.set("redis://a", { close: vi.fn(() => Promise.resolve()) });

      await expect(closeValkeyClients({ throwOnError: true })).resolves.toBeUndefined();
      expect(mockHandleValkeyError).not.toHaveBeenCalled();
    });

    it("still resolves on failures by default", async () => {
      vi.resetModules();
      const { closeValkeyClients } = await import("../shutdown.mts");
      const error = new Error("client close failed");
      mockUrlsToClients.set("redis://a", { close: vi.fn(() => Promise.reject(error)) });

      await expect(closeValkeyClients()).resolves.toBeUndefined();
      expect(mockHandleValkeyError).toHaveBeenCalledWith(error);
    });

    it("is a no-op when a later call passes throwOnError after an earlier call without it", async () => {
      vi.resetModules();
      const { closeValkeyClients } = await import("../shutdown.mts");
      mockUrlsToClients.set("redis://a", {
        close: vi.fn(() => Promise.reject(new Error("client close failed"))),
      });

      await closeValkeyClients();
      await expect(closeValkeyClients({ throwOnError: true })).resolves.toBeUndefined();
      expect(mockHandleValkeyError).toHaveBeenCalledTimes(1);
    });

    it("ignores arguments passed to onGracefulShutdown", async () => {
      vi.resetModules();
      const { onGracefulShutdown } = await import("../shutdown.mts");
      mockUrlsToClients.set("redis://a", {
        close: vi.fn(() => Promise.reject(new Error("client close failed"))),
      });

      await expect(
        (onGracefulShutdown as (...args: unknown[]) => Promise<void>)({ throwOnError: true }),
      ).resolves.toBeUndefined();
    });
  });
});
