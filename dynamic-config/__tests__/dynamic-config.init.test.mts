import { DynamicConfig } from "../../dynamic-config.mts";
import {
  closeTestDynamicConfigs,
  closeTestDynamicConfigContext,
  createDynamicConfigTestKey,
} from "./dynamic-config.test-helper.mts";
import { it, expect, afterEach, afterAll, describe } from "vitest";
import { dynamicConfigValkeyClient } from "../../clients.mts";

describe("dynamic-config.init", () => {
  afterEach(closeTestDynamicConfigs);
  afterAll(closeTestDynamicConfigContext);

  // ============================================
  // Initialization Tests
  // ============================================

  it("DynamicConfig initializes with default values", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 10,
      fieldTypes: {
        name: "string",
        count: "number",
        enabled: "boolean",
      },
      defaultFields: {
        name: "default",
        count: 0,
        enabled: false,
      },
    });

    await config.waitForInitialization();

    const fields = config.getFields();
    expect(fields.name).toBe("default");
    expect(fields.count).toBe(0);
    expect(fields.enabled).toBe(false);
  });

  it("DynamicConfig loads values from Valkey", async () => {
    const key = createDynamicConfigTestKey();
    const configKey = `dynamic-config:${key}`;

    // Set initial values in Valkey
    await dynamicConfigValkeyClient.hset(configKey, {
      name: "loaded",
      count: "42",
      enabled: "1",
    });

    const config = new DynamicConfig({
      key,
      staleTtlSeconds: 10,
      fieldTypes: {
        name: "string",
        count: "number",
        enabled: "boolean",
      },
      defaultFields: {
        name: "default",
        count: 0,
        enabled: false,
      },
    });

    await config.waitForInitialization();

    const fields = config.getFields();
    expect(fields.name).toBe("loaded");
    expect(fields.count).toBe(42);
    expect(fields.enabled).toBe(true);
  });

  it("DynamicConfig uses default staleTtl of 60 when not provided", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 0, // Falsy value should use default
      fieldTypes: { name: "string" },
      defaultFields: { name: "default" },
    });

    await config.waitForInitialization();
    expect(config.staleTtl).toBe(60);
  });
});
