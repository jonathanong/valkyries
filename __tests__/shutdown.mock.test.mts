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
});
