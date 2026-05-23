import { DynamicConfig } from "../../dynamic-config.mts";
import {
  closeTestDynamicConfigs,
  closeTestDynamicConfigContext,
  createDynamicConfigTestKey,
} from "./dynamic-config.test-helper.mts";
import { it, expect, afterEach, afterAll, describe } from "vitest";

describe("dynamic-config.fields", () => {
  afterEach(closeTestDynamicConfigs);
  afterAll(closeTestDynamicConfigContext);

  // ============================================
  // setFields / setField Tests
  // ============================================

  it("DynamicConfig.setFields updates values", async () => {
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

    await config.setFields({
      name: "updated",
      count: 100,
      enabled: true,
    });

    const fields = config.getFields();
    expect(fields.name).toBe("updated");
    expect(fields.count).toBe(100);
    expect(fields.enabled).toBe(true);
  });

  it("DynamicConfig.setFields preserves fields map identity", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 10,
      fieldTypes: {
        name: "string",
        count: "number",
      },
      defaultFields: {
        name: "default",
        count: 0,
      },
    });
    const fieldsRef = config.fields;

    await config.waitForInitialization();

    await config.setFields({
      name: "updated",
    });

    expect(config.fields).toBe(fieldsRef);
    expect(config.getFields().name).toBe("updated");
    expect(config.getFields().count).toBe(0);
  });

  it("DynamicConfig.setField updates single field", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 10,
      fieldTypes: {
        name: "string",
        count: "number",
      },
      defaultFields: {
        name: "default",
        count: 0,
      },
    });

    await config.waitForInitialization();

    await config.setField("name", "single-update");

    const fields = config.getFields();
    expect(fields.name).toBe("single-update");
    expect(fields.count).toBe(0); // Unchanged
  });

  it("DynamicConfig.setFields converts field types correctly", async () => {
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

    // Number converted to string
    await config.setField("name", 123);
    expect(config.getFields().name).toBe("123");

    // String converted to number
    await config.setField("count", "42");
    expect(config.getFields().count).toBe(42);

    // String '1' converted to boolean true
    await config.setField("enabled", "1");
    expect(config.getFields().enabled).toBe(true);

    // Number 1 converted to boolean true
    await config.setField("enabled", 1);
    expect(config.getFields().enabled).toBe(true);

    // Boolean false
    await config.setField("enabled", false);
    expect(config.getFields().enabled).toBe(false);
  });

  it("DynamicConfig.setFields throws on unknown field", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 10,
      fieldTypes: {
        name: "string",
      },
      defaultFields: {
        name: "default",
      },
    });

    await config.waitForInitialization();

    await expect(config.setFields({ unknown: "value" })).rejects.toThrow("Unknown field: unknown");
  });

  it("DynamicConfig.setFields with empty object does nothing", async () => {
    const key = createDynamicConfigTestKey();
    const config = new DynamicConfig({
      key,
      staleTtlSeconds: 10,
      fieldTypes: { name: "string" },
      defaultFields: { name: "default" },
    });

    await config.waitForInitialization();

    // This should not throw or cause issues
    await config.setFields({});

    expect(config.getFields().name).toBe("default");
  });

  it("ignores inherited properties", async () => {
    const key = createDynamicConfigTestKey();
    const config = new DynamicConfig({
      key,
      staleTtlSeconds: 10,
      fieldTypes: { name: "string" },
      defaultFields: { name: "default" },
    });
    await config.waitForInitialization();

    const fields = Object.create({ inherited: "1" });
    fields.name = "42";
    await expect(config.setFields(fields)).resolves.toBeUndefined();
    expect(config.getFields().name).toEqual("42");

    await config.close();
  });
});
