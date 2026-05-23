import { DynamicConfig } from "../../dynamic-config.mts";
import {
  closeTestDynamicConfigs,
  closeTestDynamicConfigContext,
  createDynamicConfigTestKey,
} from "./dynamic-config.test-helper.mts";
import { it, expect, afterEach, afterAll, describe } from "vitest";
import { dynamicConfigValkeyClient } from "../../clients.mts";

describe("dynamic-config.refresh", () => {
  afterEach(closeTestDynamicConfigs);
  afterAll(closeTestDynamicConfigContext);
  type FieldsMap = Record<string, { field: unknown; value: unknown }>;
  type PrivateDynamicConfig = {
    getFieldsMap: () => Promise<FieldsMap>;
    handlePubSubMessage: (msg: { channel: string; message: string }) => void;
    lastRefresh: number;
    refreshUpdatedFields: Set<string> | null;
  };

  // ============================================
  // Refresh Tests
  // ============================================

  it("DynamicConfig.refresh updates from Valkey", async () => {
    const key = createDynamicConfigTestKey();
    const configKey = `dynamic-config:${key}`;

    const config = new DynamicConfig({
      key,
      staleTtlSeconds: 1, // Short TTL for testing
      fieldTypes: {
        name: "string",
      },
      defaultFields: {
        name: "default",
      },
    });

    await config.waitForInitialization();

    // Update value in Valkey directly
    await dynamicConfigValkeyClient.hset(configKey, { name: "refreshed" });

    // Force stale TTL to pass without sleeping
    (config as unknown as { lastRefresh: number }).lastRefresh = Date.now() - 2000;

    // Trigger refresh
    await config.refresh();

    expect(config.getFields().name).toBe("refreshed");
  });

  it("DynamicConfig.refresh skips when within staleTtl", async () => {
    const key = createDynamicConfigTestKey();
    const configKey = `dynamic-config:${key}`;

    const config = new DynamicConfig({
      key,
      staleTtlSeconds: 10, // Long TTL
      fieldTypes: {
        name: "string",
      },
      defaultFields: {
        name: "default",
      },
    });

    await config.waitForInitialization();

    // First refresh to set lastRefresh timestamp
    await config.refresh();
    expect(config.getFields().name).toBe("default");

    // Update value in Valkey directly
    await dynamicConfigValkeyClient.hset(configKey, { name: "refreshed" });

    // Second refresh immediately (within staleTtl) - should skip
    await config.refresh();

    // Should still have original value because staleTtl hasn't passed
    expect(config.getFields().name).toBe("default");
  });

  it("DynamicConfig.refresh skips after close", async () => {
    const key = createDynamicConfigTestKey();
    const config = new DynamicConfig({
      key,
      staleTtlSeconds: 1,
      fieldTypes: {
        name: "string",
      },
      defaultFields: {
        name: "default",
      },
    });

    await config.waitForInitialization();
    await config.close();
    await dynamicConfigValkeyClient.hset(`dynamic-config:${key}`, { name: "closed" });

    await config.refresh();

    expect(config.getFields().name).toBe("default");
  });

  it("DynamicConfig.subscribe skips after close", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 1,
      fieldTypes: {
        name: "string",
      },
      defaultFields: {
        name: "default",
      },
    });

    await config.waitForInitialization();
    await config.close();

    await expect(config.subscribe()).resolves.toBeUndefined();
  });

  it("DynamicConfig.refresh handles missing fields with defaults", async () => {
    const key = createDynamicConfigTestKey();
    const configKey = `dynamic-config:${key}`;

    // Set initial value
    await dynamicConfigValkeyClient.hset(configKey, { name: "initial" });

    const config = new DynamicConfig({
      key,
      staleTtlSeconds: 1,
      fieldTypes: {
        name: "string",
        count: "number",
      },
      defaultFields: {
        name: "default",
        count: 42,
      },
    });

    await config.waitForInitialization();

    expect(config.getFields().name).toBe("initial");
    expect(config.getFields().count).toBe(42); // Default value

    // Delete the name field from Valkey
    await dynamicConfigValkeyClient.hdel(configKey, ["name"]);

    // Force stale TTL to pass without sleeping
    (config as unknown as { lastRefresh: number }).lastRefresh = Date.now() - 2000;
    await config.refresh();

    // Should use default values for missing fields
    expect(config.getFields().name).toBe("default");
    expect(config.getFields().count).toBe(42);
  });

  it("DynamicConfig.refresh does not overlap refresh runs", async () => {
    const key = createDynamicConfigTestKey();
    const config = new DynamicConfig({
      key,
      staleTtlSeconds: 1,
      fieldTypes: {
        name: "string",
      },
      defaultFields: {
        name: "default",
      },
    });

    await config.waitForInitialization();

    const originalGetFieldsMap = (config as unknown as PrivateDynamicConfig).getFieldsMap;
    let activeCalls = 0;
    let maxConcurrentCalls = 0;
    (config as unknown as PrivateDynamicConfig).getFieldsMap = async () => {
      activeCalls += 1;
      maxConcurrentCalls = Math.max(maxConcurrentCalls, activeCalls);
      await new Promise((resolve) => setTimeout(resolve, 25));
      const result = await originalGetFieldsMap.call(config);
      activeCalls -= 1;
      return result;
    };

    (config as unknown as PrivateDynamicConfig).lastRefresh = Date.now() - 2000;

    await Promise.all([config.refresh(), config.refresh(), config.refresh()]);

    expect(maxConcurrentCalls).toBe(1);
  });

  it("DynamicConfig.refresh skips fields updated by pubsub during refresh", async () => {
    const key = createDynamicConfigTestKey();
    const config = new DynamicConfig({
      key,
      staleTtlSeconds: 1,
      fieldTypes: {
        name: "string",
        count: "number",
      },
      defaultFields: {
        name: "default",
        count: 1,
      },
    });

    await config.waitForInitialization();

    const originalGetFieldsMap = (config as unknown as PrivateDynamicConfig).getFieldsMap;
    (config as unknown as PrivateDynamicConfig).getFieldsMap = async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return originalGetFieldsMap.call(config);
    };

    (config as unknown as PrivateDynamicConfig).lastRefresh = Date.now() - 2000;

    const refreshPromise = config.refresh();
    await new Promise((resolve) => setTimeout(resolve, 5));

    (config as unknown as PrivateDynamicConfig).handlePubSubMessage({
      channel: `dynamic-config:${key}:name`,
      message: "from-pubsub",
    });

    await refreshPromise;

    expect(config.getFields().name).toBe("from-pubsub");
    expect(config.getFields().count).toBe(1);
  });

  it("DynamicConfig.refresh leaves latest refreshUpdatedFields when replaced mid-refresh", async () => {
    const key = createDynamicConfigTestKey();
    const config = new DynamicConfig({
      key,
      staleTtlSeconds: 1,
      fieldTypes: {
        name: "string",
      },
      defaultFields: {
        name: "default",
      },
    });

    await config.waitForInitialization();

    const originalGetFieldsMap = (config as unknown as PrivateDynamicConfig).getFieldsMap;
    (config as unknown as PrivateDynamicConfig).getFieldsMap = async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return originalGetFieldsMap.call(config);
    };

    (config as unknown as PrivateDynamicConfig).lastRefresh = Date.now() - 2000;

    const refreshPromise = config.refresh();
    await new Promise((resolve) => setTimeout(resolve, 5));
    (config as unknown as PrivateDynamicConfig).refreshUpdatedFields = new Set(["name"]);

    await refreshPromise;

    expect((config as unknown as PrivateDynamicConfig).refreshUpdatedFields).toEqual(new Set(["name"]));
  });
});
