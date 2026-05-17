import { DynamicConfig, dynamicConfigs } from "../../dynamic-config.mts";
import {
  closeTestDynamicConfigs,
  closeTestDynamicConfigContext,
  createDynamicConfigTestKey,
} from "./dynamic-config.test-helper.mts";
import type { PubSubMsg } from "@valkey/valkey-glide";
import { it, expect, afterEach, afterAll, describe } from "vitest";
import {
  dynamicConfigValkeyClient,
  addPubSubMessageHandler,
  removePubSubMessageHandler,
} from "../../clients.mts";

describe("dynamic-config.edge-cases", () => {
  afterEach(closeTestDynamicConfigs);
  afterAll(closeTestDynamicConfigContext);

  // ============================================
  // stringifyField / parseField Tests
  // ============================================

  it("DynamicConfig.stringifyField handles all types", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 10,
      fieldTypes: {
        s: "string",
        n: "number",
        b: "boolean",
      },
      defaultFields: {
        s: "test",
        n: 0,
        b: false,
      },
    });

    await config.waitForInitialization();

    expect(config.stringifyField("string", "hello")).toBe("hello");
    expect(config.stringifyField("string", 123)).toBe("123");
    expect(config.stringifyField("number", 42)).toBe("42");
    expect(config.stringifyField("number", 3.14)).toBe("3.14");
    expect(config.stringifyField("boolean", true)).toBe("1");
    expect(config.stringifyField("boolean", false)).toBe("0");
  });

  it("DynamicConfig.parseField handles all types", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 10,
      fieldTypes: {
        s: "string",
        n: "number",
        b: "boolean",
      },
      defaultFields: {
        s: "test",
        n: 0,
        b: false,
      },
    });

    await config.waitForInitialization();

    expect(config.parseField("string", "hello")).toBe("hello");
    expect(config.parseField("number", "42")).toBe(42);
    expect(config.parseField("number", "3.14")).toBe(3.14);
    expect(config.parseField("boolean", "1")).toBe(true);
    expect(config.parseField("boolean", "0")).toBe(false);
  });

  // ============================================
  // Edge Cases
  // ============================================

  it("DynamicConfig handles falsy default values correctly", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 10,
      fieldTypes: {
        emptyString: "string",
        zero: "number",
        falseBoolean: "boolean",
      },
      defaultFields: {
        emptyString: "",
        zero: 0,
        falseBoolean: false,
      },
    });

    await config.waitForInitialization();

    const fields = config.getFields();
    expect(fields.emptyString).toBe("");
    expect(fields.zero).toBe(0);
    expect(fields.falseBoolean).toBe(false);
  });

  it("DynamicConfig reads back empty string stored in Valkey (not replaced by default)", async () => {
    // Regression test: applyFieldsFromMap must not treat "" as missing.
    // Before fix, `if (valkeyEntry?.value)` was falsy for "", reverting to default.
    const key = createDynamicConfigTestKey();

    const config1 = new DynamicConfig({
      key,
      staleTtlSeconds: 10,
      fieldTypes: { name: "string" },
      defaultFields: { name: "default-name" },
    });
    await config1.waitForInitialization();
    await config1.setField("name", "");

    // Second instance reads from Valkey and must see "" not the default
    const config2 = new DynamicConfig({
      key,
      staleTtlSeconds: 10,
      fieldTypes: { name: "string" },
      defaultFields: { name: "default-name" },
    });
    await config2.waitForInitialization();
    expect(config2.getFields().name).toBe("");
  });

  it("DynamicConfig persists values to Valkey on setFields", async () => {
    const key = createDynamicConfigTestKey();
    const configKey = `dynamic-config:${key}`;

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

    await config.setFields({
      name: "persisted",
      count: 99,
      enabled: true,
    });

    // Read directly from Valkey to verify persistence
    const stored = await dynamicConfigValkeyClient.hgetall(configKey);

    // Convert array result to map
    const storedMap = new Map<string, string>();
    if (Array.isArray(stored)) {
      for (const entry of stored) {
        if (entry && typeof entry === "object" && "field" in entry && "value" in entry) {
          storedMap.set(entry.field.toString(), entry.value.toString());
        }
      }
    }

    expect(storedMap.get("name")).toBe("persisted");
    expect(storedMap.get("count")).toBe("99");
    expect(storedMap.get("enabled")).toBe("1");
  });

  it("DynamicConfig adds to dynamicConfigs array on initialization", async () => {
    const initialLength = dynamicConfigs.length;

    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 10,
      fieldTypes: { name: "string" },
      defaultFields: { name: "default" },
    });

    await config.waitForInitialization();

    expect(dynamicConfigs.length).toBe(initialLength + 1);
    expect(dynamicConfigs).toContain(config);
  });

  // ============================================
  // Pub/Sub Message Handler Tests
  // ============================================

  const nopHandler = (_msg: PubSubMsg) => {};

  it("addPubSubMessageHandler adds handler to list", () => {
    // Should not throw
    expect(() => addPubSubMessageHandler(nopHandler)).not.toThrow();

    // Clean up
    removePubSubMessageHandler(nopHandler);
  });

  it("removePubSubMessageHandler removes handler from list", () => {
    addPubSubMessageHandler(nopHandler);

    // Should not throw
    expect(() => removePubSubMessageHandler(nopHandler)).not.toThrow();
  });

  it("removePubSubMessageHandler does nothing if handler not found", () => {
    // Should not throw when removing a handler that was never added
    expect(() => removePubSubMessageHandler(nopHandler)).not.toThrow();
  });
});
