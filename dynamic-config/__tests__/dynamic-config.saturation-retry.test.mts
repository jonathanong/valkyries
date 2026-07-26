/**
 * Unit coverage for DynamicConfig's inflight-saturation retry command boundaries.
 * The subscription lifecycle is deliberately mocked: it is not a storage command.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlideClient } from "@valkey/valkey-glide";

const clients = vi.hoisted(() => ({
  addPubSubMessageHandler: vi.fn(),
  dynamicConfigValkeyClient: {},
  ensureDynamicConfigValkeySubscriptionClient: vi.fn(),
  removePubSubMessageHandler: vi.fn(),
}));

vi.mock("../../clients.mts", () => clients);

import { config as packageConfig } from "../../config.mts";
import { DynamicConfig, dynamicConfigs } from "../../dynamic-config.mts";

type CommandClient = {
  client: GlideClient;
  hgetall: ReturnType<typeof vi.fn>;
  invokeScript: ReturnType<typeof vi.fn>;
};

function makeClient({
  reads = [],
  writes = [],
}: {
  reads?: unknown[];
  writes?: unknown[];
} = {}): CommandClient {
  let readIndex = 0;
  let writeIndex = 0;
  const next = (responses: unknown[], index: number, fallback: unknown) =>
    index < responses.length ? responses[index] : fallback;
  const hgetall = vi.fn(() => {
    const response = next(reads, readIndex++, []);
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
  });
  const invokeScript = vi.fn(() => {
    const response = next(writes, writeIndex++, null);
    return response instanceof Error ? Promise.reject(response) : Promise.resolve(response);
  });

  return {
    client: { hgetall, invokeScript } as unknown as GlideClient,
    hgetall,
    invokeScript,
  };
}

function createDynamicConfig(client: GlideClient, retryOptions = {}) {
  return new DynamicConfig({
    key: `retry-${crypto.randomUUID()}`,
    fieldTypes: { name: "string" },
    defaultFields: { name: "default" },
    client,
    ...retryOptions,
  });
}

describe("DynamicConfig.saturation-retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clients.ensureDynamicConfigValkeySubscriptionClient.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await Promise.all([...dynamicConfigs].map((dynamicConfig) => dynamicConfig.close()));
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("retries a saturated HGETALL during initialization and then applies defaults", async () => {
    const { client, hgetall, invokeScript } = makeClient({
      reads: [
        new Error("Reached maximum inflight requests"),
        new Error("Reached maximum inflight requests"),
        [],
      ],
    });
    const dynamicConfig = createDynamicConfig(client, {
      inflightRetryAttempts: 3,
      inflightRetryDelayMs: 1,
    });

    const initialization = dynamicConfig.waitForInitialization();
    await vi.advanceTimersByTimeAsync(10);
    await initialization;

    expect(hgetall).toHaveBeenCalledTimes(3);
    expect(invokeScript).toHaveBeenCalledTimes(1);
    expect(dynamicConfig.getFields()).toEqual({ name: "default" });
  });

  it("retries the initialization script that writes missing defaults", async () => {
    const { client, invokeScript } = makeClient({
      reads: [[]],
      writes: [new Error("Reached maximum inflight requests"), null],
    });
    const dynamicConfig = createDynamicConfig(client, {
      inflightRetryAttempts: 2,
      inflightRetryDelayMs: 1,
    });

    const initialization = dynamicConfig.waitForInitialization();
    await vi.advanceTimersByTimeAsync(5);
    await initialization;

    expect(invokeScript).toHaveBeenCalledTimes(2);
    expect(dynamicConfig.getFields()).toEqual({ name: "default" });
  });

  it("uses the package retry defaults when options are omitted", async () => {
    const { client } = makeClient({ reads: [[{ field: "name", value: "stored" }]] });
    const dynamicConfig = createDynamicConfig(client);

    await dynamicConfig.waitForInitialization();

    const internal = dynamicConfig as unknown as {
      inflightRetryAttempts: number;
      inflightRetryDelayMs: number;
    };
    expect(internal.inflightRetryAttempts).toBe(packageConfig.inflight_retry_attempts);
    expect(internal.inflightRetryDelayMs).toBe(packageConfig.inflight_retry_delay_ms);
  });

  it("honors explicit retry attempts and delay for a saturated HGETALL", async () => {
    const timeouts: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn: () => void, ms?: number) => {
      timeouts.push(ms ?? 0);
      return originalSetTimeout(fn, ms);
    });

    const { client, hgetall } = makeClient({
      reads: [
        new Error("Reached maximum inflight requests"),
        new Error("Reached maximum inflight requests"),
      ],
    });
    const dynamicConfig = createDynamicConfig(client, {
      inflightRetryAttempts: 2,
      inflightRetryDelayMs: 50,
    });

    const initialization = dynamicConfig.waitForInitialization();
    const assertion = expect(initialization).rejects.toThrow("Reached maximum inflight requests");
    await vi.advanceTimersByTimeAsync(250);
    await assertion;

    expect(hgetall).toHaveBeenCalledTimes(2);
    expect(timeouts).toHaveLength(1);
    expect(timeouts[0]).toBeGreaterThanOrEqual(50);
    expect(timeouts[0]).toBeLessThanOrEqual(250);
  });

  it("retries the atomic set-fields script and updates local state after recovery", async () => {
    const { client, invokeScript } = makeClient({
      reads: [[{ field: "name", value: "default" }]],
      writes: [new Error("Reached maximum inflight requests"), null],
    });
    const dynamicConfig = createDynamicConfig(client, {
      inflightRetryAttempts: 2,
      inflightRetryDelayMs: 1,
    });
    await dynamicConfig.waitForInitialization();

    const write = dynamicConfig.setField("name", "updated");
    await vi.advanceTimersByTimeAsync(5);
    await write;

    expect(invokeScript).toHaveBeenCalledTimes(2);
    expect(dynamicConfig.getFields()).toEqual({ name: "updated" });
  });

  it("does not update local fields when set-fields exhausts saturation retries", async () => {
    const { client, invokeScript } = makeClient({
      reads: [[{ field: "name", value: "default" }]],
      writes: [
        new Error("Reached maximum inflight requests"),
        new Error("Reached maximum inflight requests"),
      ],
    });
    const dynamicConfig = createDynamicConfig(client, {
      inflightRetryAttempts: 2,
      inflightRetryDelayMs: 1,
    });
    await dynamicConfig.waitForInitialization();

    const write = dynamicConfig.setField("name", "updated");
    const assertion = expect(write).rejects.toThrow("Reached maximum inflight requests");
    await vi.advanceTimersByTimeAsync(5);
    await assertion;

    expect(invokeScript).toHaveBeenCalledTimes(2);
    expect(dynamicConfig.getFields()).toEqual({ name: "default" });
  });

  it("immediately rethrows non-saturation storage errors", async () => {
    const error = new Error("Connection closed");
    const { client, hgetall } = makeClient({ reads: [error] });
    const dynamicConfig = createDynamicConfig(client, {
      inflightRetryAttempts: 3,
      inflightRetryDelayMs: 1,
    });

    await expect(dynamicConfig.waitForInitialization()).rejects.toThrow(error);
    expect(hgetall).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resets the refresh timestamp after a saturated HGETALL is exhausted", async () => {
    const { client, hgetall } = makeClient({
      reads: [
        [{ field: "name", value: "default" }],
        new Error("Reached maximum inflight requests"),
        new Error("Reached maximum inflight requests"),
      ],
    });
    const dynamicConfig = createDynamicConfig(client, {
      staleTtlSeconds: 10,
      inflightRetryAttempts: 2,
      inflightRetryDelayMs: 1,
    });
    await dynamicConfig.waitForInitialization();
    const internal = dynamicConfig as unknown as { lastRefresh: number };
    internal.lastRefresh = Date.now() - 10_001;

    const refresh = dynamicConfig.refresh();
    const assertion = expect(refresh).rejects.toThrow("Reached maximum inflight requests");
    await vi.advanceTimersByTimeAsync(5);
    await assertion;

    expect(hgetall).toHaveBeenCalledTimes(3);
    expect(internal.lastRefresh).toBe(0);
  });
});
