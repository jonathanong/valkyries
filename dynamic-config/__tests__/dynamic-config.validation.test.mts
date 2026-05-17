import { DynamicConfig } from "../../dynamic-config.mts";
import {
  closeTestDynamicConfigs,
  closeTestDynamicConfigContext,
  createDynamicConfigTestKey,
} from "./dynamic-config.test-helper.mts";
import type { DynamicConfigOptions } from "../../types.mts";
import { it, expect, afterEach, afterAll, describe } from "vitest";

describe("dynamic-config.validation", () => {
  afterEach(closeTestDynamicConfigs);
  afterAll(closeTestDynamicConfigContext);

  // ============================================
  // Validation Tests
  // ============================================

  it("DynamicConfig validates default field types - string", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 10,
      fieldTypes: {
        name: "string",
      },
      defaultFields: {
        name: 123, // Wrong type
      },
    });

    await expect(config.waitForInitialization()).rejects.toThrow(
      "Default field name is not of type string",
    );
  });

  it("DynamicConfig validates default field types - number", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 10,
      fieldTypes: {
        count: "number",
      },
      defaultFields: {
        count: "not a number", // Wrong type
      },
    });

    await expect(config.waitForInitialization()).rejects.toThrow(
      "Default field count is not of type number",
    );
  });

  it("DynamicConfig validates default field types - boolean", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 10,
      fieldTypes: {
        enabled: "boolean",
      },
      defaultFields: {
        enabled: "true", // Wrong type (string instead of boolean)
      },
    });

    await expect(config.waitForInitialization()).rejects.toThrow(
      "Default field enabled is not of type boolean",
    );
  });

  it("DynamicConfig validates all default fields are defined", async () => {
    const config = new DynamicConfig({
      key: createDynamicConfigTestKey(),
      staleTtlSeconds: 10,
      fieldTypes: {
        name: "string",
        missing: "string",
      },
      defaultFields: {
        name: "default",
        // missing field
      },
    });

    await expect(config.waitForInitialization()).rejects.toThrow(
      "Default field missing is not defined",
    );
  });

  it("DynamicConfig prevents duplicate initialization in non-test mode", async () => {
    // This test only works when NODE_ENV is not 'test'
    // In test mode, duplicates are allowed
    if (process.env.NODE_ENV === "test") {
      // Skip this test in test mode
      return;
    }

    const key = createDynamicConfigTestKey();
    const options: DynamicConfigOptions = {
      key,
      staleTtlSeconds: 10,
      fieldTypes: { name: "string" },
      defaultFields: { name: "default" },
    };

    const config1 = new DynamicConfig(options);
    await config1.waitForInitialization();

    const config2 = new DynamicConfig(options);
    await expect(config2.waitForInitialization()).rejects.toThrow(
      "DynamicConfig already initialized",
    );

    await config1.close();
  });
});
