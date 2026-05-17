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
});
