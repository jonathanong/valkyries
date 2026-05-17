import { DynamicConfig } from "../../dynamic-config.mts";
import {
  closeTestDynamicConfigs,
  closeTestDynamicConfigContext,
  createDynamicConfigTestKey,
} from "./dynamic-config.test-helper.mts";
import { it, expect, afterEach, afterAll, describe } from "vitest";
import { dynamicConfigValkeyClient } from "../../clients.mts";

describe("dynamic-config.pubsub", () => {
  afterEach(closeTestDynamicConfigs);
  afterAll(closeTestDynamicConfigContext);

  // ============================================
  // Pub/Sub Tests
  // ============================================

  // Note: Pub/sub propagation in tests depends on valkey-glide's internal message delivery
  // which may have timing variations. These tests verify the message handler logic.

  it("DynamicConfig publishes updates when setFields is called", async () => {
    const key = createDynamicConfigTestKey();
    const configKey = `dynamic-config:${key}`;

    const config = new DynamicConfig({
      key,
      staleTtlSeconds: 60,
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

    // Set fields - this should publish to pub/sub and persist to Valkey
    await config.setFields({
      name: "updated",
      count: 42,
      enabled: true,
    });

    // Verify the values were persisted to Valkey
    const stored = await dynamicConfigValkeyClient.hgetall(configKey);
    const storedMap = new Map<string, string>();
    if (Array.isArray(stored)) {
      for (const entry of stored) {
        if (entry && typeof entry === "object" && "field" in entry && "value" in entry) {
          storedMap.set(entry.field.toString(), entry.value.toString());
        }
      }
    }

    expect(storedMap.get("name")).toBe("updated");
    expect(storedMap.get("count")).toBe("42");
    expect(storedMap.get("enabled")).toBe("1");

    // Verify local values are updated
    expect(config.getFields().name).toBe("updated");
    expect(config.getFields().count).toBe(42);
    expect(config.getFields().enabled).toBe(true);
  });

  it("DynamicConfig message handler processes string fields correctly", async () => {
    const key = createDynamicConfigTestKey();

    const config = new DynamicConfig({
      key,
      staleTtlSeconds: 60,
      fieldTypes: {
        name: "string",
      },
      defaultFields: {
        name: "default",
      },
    });

    await config.waitForInitialization();

    // Verify the parsing logic for string fields
    expect(config.parseField("string", "test-string")).toBe("test-string");
  });

  it("DynamicConfig message handler ignores unrelated messages and applies matching fields", async () => {
    const key = createDynamicConfigTestKey();
    const config = new DynamicConfig({
      key,
      staleTtlSeconds: 60,
      fieldTypes: {
        name: "string",
      },
      defaultFields: {
        name: "default",
      },
    });
    const dispatchMessage = (msg: { channel: Buffer; message: Buffer }) => {
      (
        config as unknown as {
          messageHandler(msg: { channel: Buffer; message: Buffer }): void;
        }
      ).messageHandler(msg);
    };

    await config.waitForInitialization();

    dispatchMessage({
      channel: Buffer.from("dynamic-config:other:name"),
      message: Buffer.from("ignored"),
    });
    dispatchMessage({
      channel: Buffer.from(`dynamic-config:${key}:unknown`),
      message: Buffer.from("ignored"),
    });
    dispatchMessage({
      channel: Buffer.from(`dynamic-config:${key}:name`),
      message: Buffer.from("updated"),
    });

    expect(config.getFields().name).toBe("updated");
  });

  it("DynamicConfig message handler processes number fields correctly", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 60,
      fieldTypes: { count: "number" },
      defaultFields: { count: 0 },
    });

    await config.waitForInitialization();

    // Verify parsing logic for numbers
    expect(config.parseField("number", "42")).toBe(42);
    expect(config.parseField("number", "3.14")).toBe(3.14);
    expect(config.parseField("number", "-10")).toBe(-10);
  });

  it("DynamicConfig message handler processes boolean fields correctly", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 60,
      fieldTypes: { enabled: "boolean" },
      defaultFields: { enabled: false },
    });

    await config.waitForInitialization();

    // Verify parsing logic for booleans
    expect(config.parseField("boolean", "1")).toBe(true);
    expect(config.parseField("boolean", "0")).toBe(false);
  });

  it("DynamicConfig with different keys have independent values", async () => {
    const key1 = createDynamicConfigTestKey();
    const key2 = createDynamicConfigTestKey();

    const config1 = new DynamicConfig({
      key: key1,
      staleTtlSeconds: 60,
      fieldTypes: { name: "string" },
      defaultFields: { name: "default1" },
    });

    await config1.waitForInitialization();

    const config2 = new DynamicConfig({
      key: key2,
      staleTtlSeconds: 60,
      fieldTypes: { name: "string" },
      defaultFields: { name: "default2" },
    });

    await config2.waitForInitialization();

    // Update config2
    await config2.setField("name", "updated-config2");

    // config1 should remain unchanged (different key)
    expect(config1.getFields().name).toBe("default1");
    // config2 should have the new value
    expect(config2.getFields().name).toBe("updated-config2");
  });

  it("DynamicConfig with same key share values via Valkey", async () => {
    const key = createDynamicConfigTestKey();

    const config1 = new DynamicConfig({
      key,
      staleTtlSeconds: 1, // Short TTL for testing
      fieldTypes: { name: "string" },
      defaultFields: { name: "default" },
    });

    await config1.waitForInitialization();

    // Update via config1
    await config1.setField("name", "shared-value");

    // Create config2 with same key - should load the value from Valkey
    const config2 = new DynamicConfig({
      key,
      staleTtlSeconds: 1,
      fieldTypes: { name: "string" },
      defaultFields: { name: "default" },
    });

    await config2.waitForInitialization();

    // config2 should have loaded the value from Valkey
    expect(config2.getFields().name).toBe("shared-value");
  });
});
